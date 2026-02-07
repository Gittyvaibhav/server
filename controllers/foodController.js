const fs = require("fs");
const path = require("path");
const { InferenceClient } = require("@huggingface/inference");
const { Blob } = require("buffer");

const MIN_CONFIDENCE = Number.parseFloat(
  process.env.FOOD_CONFIDENCE_MIN || "0.6"
);
const NUTRITION_MIN_CONFIDENCE = Number.parseFloat(
  process.env.NUTRITION_CONFIDENCE_MIN || "0.4"
);

const getModel = (requestedModel) => {
  if (requestedModel) return requestedModel;
  if (process.env.HF_FOOD_MODEL) return process.env.HF_FOOD_MODEL;
  if (process.env.HF_MODEL) return process.env.HF_MODEL;
  return "nateraw/food";
};

const normalizeLabel = (label) =>
  (label || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatFoodLabel = (label) => {
  const normalized = normalizeLabel(label);
  if (!normalized) return "Unknown food";
  const keepLower = new Set([
    "and",
    "or",
    "with",
    "of",
    "the",
    "a",
    "an",
    "in",
    "on",
    "to",
    "for",
  ]);
  return normalized
    .split(" ")
    .map((word, idx) => {
      if (idx > 0 && keepLower.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
};

const extractJson = (text) => {
  if (!text) return "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "";
  return text.slice(start, end + 1);
};

const coerceNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const estimateNutritionWithAI = async (client, label) => {
  const model = process.env.HF_NUTRITION_MODEL || process.env.HF_MODEL;
  if (!model) {
    return null;
  }

  const prompt = [
    "You are a nutrition estimator.",
    "Given a food label, estimate typical nutrition for a common serving.",
    "Use grams for macros and kcal for calories.",
    "Return ONLY valid JSON with this schema:",
    '{ "calories": number, "protein": number, "carbs": number, "fats": number, "serving": string, "note": string, "confidence": number }',
    "Do not include any extra text.",
    `Food label: ${label}`,
  ].join("\n");

  const lowerModel = (model || "").toLowerCase();
  const taskOverride = (process.env.HF_NUTRITION_TASK || "").toLowerCase();
  const useTextGeneration =
    taskOverride === "text" ||
    (taskOverride !== "chat" &&
      (lowerModel.includes("gpt2") ||
        lowerModel.includes("t5") ||
        lowerModel.includes("flan")));

  const runTextGeneration = async () => {
    const response = await client.textGeneration({
      model,
      inputs: prompt,
      parameters: {
        max_new_tokens: 180,
        temperature: 0.2,
        return_full_text: false,
      },
    });
    return (
      response?.generated_text ||
      response?.[0]?.generated_text ||
      response?.output_text ||
      ""
    );
  };

  const runChatCompletion = async () => {
    const completion = await client.chatCompletion({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 180,
      temperature: 0.2,
    });
    return (
      completion?.choices?.[0]?.message?.content ||
      completion?.choices?.[0]?.delta?.content ||
      ""
    );
  };

  let generated = "";
  try {
    generated = useTextGeneration
      ? await runTextGeneration()
      : await runChatCompletion();
  } catch (err) {
    // Fallback to the other task if the provider rejects the first one.
    const detailsText =
      err?.response?.data || err?.message || "Unknown error";
    const text =
      typeof detailsText === "string"
        ? detailsText
        : JSON.stringify(detailsText);
    const taskError = /task|unsupported|does not support/i.test(text);
    if (taskError) {
      generated = useTextGeneration
        ? await runChatCompletion()
        : await runTextGeneration();
    } else {
      throw err;
    }
  }

  const jsonText = extractJson(generated);
  if (!jsonText) return null;

  const parsed = JSON.parse(jsonText);

  const result = {
    calories: coerceNumber(parsed.calories),
    protein: coerceNumber(parsed.protein),
    carbs: coerceNumber(parsed.carbs),
    fats: coerceNumber(parsed.fats),
    serving: typeof parsed.serving === "string" ? parsed.serving : null,
    note: typeof parsed.note === "string" ? parsed.note : "Estimated per typical serving.",
    confidence: coerceNumber(parsed.confidence),
  };
  const hasMacros =
    result.calories !== null ||
    result.protein !== null ||
    result.carbs !== null ||
    result.fats !== null;
  if (!hasMacros) return null;
  return result;
};

exports.scanFood = async (req, res) => {
  const filePath = req.file?.path;
  const fileBuffer = req.file?.buffer;
  if (!filePath && !fileBuffer) {
    return res.status(400).json({
      error: "No image uploaded",
      message: "Please upload an image file using the 'image' field.",
    });
  }

  if (!process.env.HF_TOKEN) {
    return res.status(400).json({
      error: "Hugging Face token not configured",
      message: "Please set HF_TOKEN in .env file",
    });
  }

  const requestedModel = req.body?.model;
  const model = getModel(requestedModel);
  const client = new InferenceClient(process.env.HF_TOKEN);

  try {
    const imageBuffer = fileBuffer || fs.readFileSync(filePath);
    const contentType = req.file?.mimetype || "image/jpeg";
    const imageBlob = new Blob([imageBuffer], { type: contentType });

    const predictions = await client.imageClassification({
      model,
      data: imageBlob,
    });

    const topPredictions = Array.isArray(predictions) ? predictions : [];
    const top = topPredictions[0];
    const confidence = typeof top?.score === "number" ? top.score : 0;

    if (!top?.label) {
      return res.status(422).json({
        error: "No food detected",
        message: "No food detected in the image. Please try another image.",
      });
    }

    const highConfidence = confidence >= MIN_CONFIDENCE;

    const nutrition = await estimateNutritionWithAI(client, top.label);
    const displayLabel = formatFoodLabel(top.label);
    const nutritionConfidence =
      typeof nutrition?.confidence === "number" ? nutrition.confidence : null;
    const nutritionOk =
      nutritionConfidence === null
        ? Boolean(nutrition?.calories || nutrition?.protein || nutrition?.carbs || nutrition?.fats)
        : nutritionConfidence >= NUTRITION_MIN_CONFIDENCE;
    if (!nutritionOk) {
      return res.status(422).json({
        error: "Nutrition estimate unavailable",
        message:
          "The nutrition model could not provide a reliable estimate. Try a clearer photo or a more specific food label.",
        details: {
          food: displayLabel,
          confidence: nutritionConfidence,
          minRequired: NUTRITION_MIN_CONFIDENCE,
          model: process.env.HF_NUTRITION_MODEL || process.env.HF_MODEL,
        },
      });
    }

    return res.json({
      food: displayLabel,
      calories: nutrition?.calories ?? null,
      protein: nutrition?.protein ?? null,
      carbs: nutrition?.carbs ?? null,
      fats: nutrition?.fats ?? null,
      serving: nutrition?.serving ?? null,
      calorieNote: nutrition?.note || "Estimated per typical serving.",
      model,
      highConfidence,
      confidence,
      warning: [
        highConfidence ? null : "Low confidence food prediction.",
        nutritionOk ? null : "Nutrition estimate has low confidence or is unavailable.",
      ].filter(Boolean).join(" ") || null,
    });
  } catch (err) {
    console.error("Food scan error details:", {
      status: err?.response?.status || err?.status,
      message: err?.message,
      response: err?.response?.data,
    });
    const status = err?.response?.status || err?.status;
    const details = err?.response?.data || err?.message || "Unknown error";

    let userMessage = "Food scan failed. Please try again.";
    const detailsText =
      typeof details === "string" ? details : JSON.stringify(details);

    if (
      /image[-\s]?classification/i.test(detailsText) &&
      /(not|unsupported|does not support|task)/i.test(detailsText)
    ) {
      userMessage =
        "The configured HF model does not support image classification. Set HF_FOOD_MODEL to an image model (e.g., nateraw/food).";
    } else if (status === 401 || status === 403) {
      userMessage =
        "Hugging Face rejected the request. Check HF_TOKEN and model access (gated models require accepting terms).";
    } else if (status === 404) {
      userMessage = "Hugging Face model not found. Verify HF_FOOD_MODEL is correct.";
    } else if (status === 429) {
      userMessage = "Hugging Face rate limit reached. Please wait and try again.";
    } else if (status === 503) {
      userMessage = "Hugging Face provider is unavailable. Try again in a few minutes.";
    }

    // If we don't have a status-based hint, surface the provider error details
    if (!status && detailsText) {
      userMessage = detailsText;
    }

    if (/task|unsupported|does not support/i.test(detailsText)) {
      userMessage =
        "The configured nutrition model does not support the requested task. " +
        "Set HF_NUTRITION_TASK=chat for chat-only models or HF_NUTRITION_TASK=text for text-generation models.";
    }

    const httpStatus = status || 500;

    const debug =
      process.env.NODE_ENV !== "production"
        ? {
            providerStatus: status || httpStatus,
            providerResponse: err?.response?.data,
            model,
            requestedModel,
          }
        : undefined;

    return res.status(httpStatus).json({
      error: "Failed to scan food image",
      message: userMessage,
      status: status || httpStatus,
      details: detailsText,
      debug,
    });
  } finally {
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        const name = path.basename(filePath);
        console.warn(
          `Cleanup failed for ${name}:`,
          cleanupErr?.message || cleanupErr
        );
      }
    }
  }
};
