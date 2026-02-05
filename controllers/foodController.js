const fs = require("fs");
const path = require("path");
const { InferenceClient } = require("@huggingface/inference");
const { Blob } = require("buffer");

const MIN_CONFIDENCE = Number.parseFloat(
  process.env.FOOD_CONFIDENCE_MIN || "0.6"
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

const calculateMacros = (calories, split = { protein: 0.3, carbs: 0.4, fats: 0.3 }) => ({
  protein: Math.round((calories * split.protein) / 4),
  carbs: Math.round((calories * split.carbs) / 4),
  fats: Math.round((calories * split.fats) / 9),
});

const estimateNutrition = (label) => {
  const name = normalizeLabel(label);
  const overrides = {
    "fried rice": { calories: 520, serving: "1.5 cups (300 g)", protein: 13, carbs: 75, fats: 20 },
    "white rice": { calories: 205, serving: "1 cup cooked", protein: 4, carbs: 45, fats: 0 },
    "brown rice": { calories: 215, serving: "1 cup cooked", protein: 5, carbs: 45, fats: 2 },
    pho: { calories: 450, serving: "1 bowl", protein: 28, carbs: 50, fats: 12 },
    "chicken curry": { calories: 480, serving: "1 cup", protein: 28, carbs: 25, fats: 28 },
    "pad thai": { calories: 550, serving: "1.5 cups", protein: 18, carbs: 75, fats: 22 },
    ramen: { calories: 480, serving: "1 bowl", protein: 20, carbs: 60, fats: 16 },
    pizza: { calories: 285, serving: "1 slice", protein: 12, carbs: 36, fats: 10 },
    hamburger: { calories: 500, serving: "1 burger", protein: 26, carbs: 40, fats: 24 },
    "hot dog": { calories: 300, serving: "1 hot dog", protein: 12, carbs: 22, fats: 18 },
    tacos: { calories: 210, serving: "1 taco", protein: 10, carbs: 20, fats: 9 },
    sushi: { calories: 300, serving: "6 pieces", protein: 12, carbs: 45, fats: 6 },
    "french fries": { calories: 365, serving: "1 medium", protein: 4, carbs: 48, fats: 17 },
    lasagna: { calories: 520, serving: "1 slice", protein: 24, carbs: 45, fats: 26 },
    "macaroni and cheese": { calories: 480, serving: "1.5 cups", protein: 18, carbs: 50, fats: 22 },
    "chicken wings": { calories: 430, serving: "6 wings", protein: 28, carbs: 10, fats: 32 },
    steak: { calories: 650, serving: "8 oz", protein: 55, carbs: 0, fats: 45 },
    waffles: { calories: 420, serving: "2 waffles", protein: 10, carbs: 55, fats: 16 },
    pancakes: { calories: 350, serving: "2 pancakes", protein: 8, carbs: 55, fats: 10 },
    "grilled chicken": { calories: 330, serving: "6 oz", protein: 52, carbs: 0, fats: 7 },
    "fried chicken": { calories: 420, serving: "2 pieces", protein: 28, carbs: 18, fats: 26 },
    "chicken biryani": { calories: 550, serving: "1.5 cups", protein: 25, carbs: 70, fats: 18 },
    "vegetable biryani": { calories: 480, serving: "1.5 cups", protein: 9, carbs: 75, fats: 14 },
    "butter chicken": { calories: 580, serving: "1 cup", protein: 28, carbs: 18, fats: 40 },
    "paneer butter masala": { calories: 520, serving: "1 cup", protein: 18, carbs: 20, fats: 38 },
    "dal": { calories: 230, serving: "1 cup", protein: 12, carbs: 34, fats: 5 },
    "naan": { calories: 260, serving: "1 naan", protein: 8, carbs: 45, fats: 6 },
    "chapati": { calories: 120, serving: "1 roti", protein: 3, carbs: 20, fats: 3 },
    "samosa": { calories: 260, serving: "1 samosa", protein: 4, carbs: 28, fats: 14 },
    "spring rolls": { calories: 300, serving: "4 rolls", protein: 7, carbs: 35, fats: 15 },
    "caesar salad": { calories: 360, serving: "1 bowl", protein: 10, carbs: 18, fats: 28 },
    "greek salad": { calories: 220, serving: "1 bowl", protein: 6, carbs: 12, fats: 16 },
    "chicken salad": { calories: 380, serving: "1 bowl", protein: 28, carbs: 10, fats: 24 },
    "tuna salad": { calories: 340, serving: "1 bowl", protein: 24, carbs: 8, fats: 22 },
    "cheeseburger": { calories: 560, serving: "1 burger", protein: 30, carbs: 40, fats: 32 },
    "bacon burger": { calories: 650, serving: "1 burger", protein: 35, carbs: 40, fats: 40 },
    "club sandwich": { calories: 520, serving: "1 sandwich", protein: 24, carbs: 48, fats: 24 },
    "grilled cheese": { calories: 400, serving: "1 sandwich", protein: 14, carbs: 32, fats: 22 },
    "chicken sandwich": { calories: 430, serving: "1 sandwich", protein: 28, carbs: 38, fats: 16 },
    "turkey sandwich": { calories: 380, serving: "1 sandwich", protein: 24, carbs: 38, fats: 10 },
    "spaghetti bolognese": { calories: 520, serving: "1.5 cups", protein: 24, carbs: 60, fats: 18 },
    "fettuccine alfredo": { calories: 680, serving: "1.5 cups", protein: 20, carbs: 62, fats: 36 },
    "chicken alfredo": { calories: 700, serving: "1.5 cups", protein: 35, carbs: 60, fats: 34 },
    "pesto pasta": { calories: 560, serving: "1.5 cups", protein: 14, carbs: 62, fats: 26 },
    "risotto": { calories: 520, serving: "1.5 cups", protein: 12, carbs: 75, fats: 18 },
    "beef taco": { calories: 240, serving: "1 taco", protein: 12, carbs: 20, fats: 11 },
    "chicken taco": { calories: 210, serving: "1 taco", protein: 14, carbs: 18, fats: 8 },
    "burrito": { calories: 700, serving: "1 burrito", protein: 28, carbs: 80, fats: 24 },
    "quesadilla": { calories: 480, serving: "1 quesadilla", protein: 20, carbs: 40, fats: 24 },
    "nachos": { calories: 520, serving: "1 plate", protein: 16, carbs: 52, fats: 28 },
    "salmon": { calories: 370, serving: "6 oz", protein: 39, carbs: 0, fats: 22 },
    "grilled salmon": { calories: 370, serving: "6 oz", protein: 39, carbs: 0, fats: 22 },
    "tuna steak": { calories: 330, serving: "6 oz", protein: 42, carbs: 0, fats: 12 },
    "shrimp": { calories: 200, serving: "6 oz", protein: 36, carbs: 2, fats: 3 },
    "fried shrimp": { calories: 350, serving: "6 oz", protein: 24, carbs: 24, fats: 18 },
    "chicken noodle soup": { calories: 220, serving: "1 bowl", protein: 15, carbs: 20, fats: 8 },
    "tomato soup": { calories: 180, serving: "1 bowl", protein: 4, carbs: 26, fats: 6 },
    "clam chowder": { calories: 300, serving: "1 bowl", protein: 10, carbs: 26, fats: 16 },
    "miso soup": { calories: 80, serving: "1 bowl", protein: 6, carbs: 10, fats: 2 },
    "scrambled eggs": { calories: 200, serving: "2 eggs", protein: 13, carbs: 2, fats: 15 },
    "omelette": { calories: 250, serving: "2 eggs", protein: 16, carbs: 4, fats: 18 },
    "avocado toast": { calories: 280, serving: "1 slice", protein: 6, carbs: 26, fats: 16 },
    "oatmeal": { calories: 190, serving: "1 cup", protein: 6, carbs: 32, fats: 4 },
    "granola": { calories: 280, serving: "1/2 cup", protein: 6, carbs: 40, fats: 10 },
    "yogurt parfait": { calories: 260, serving: "1 cup", protein: 12, carbs: 40, fats: 6 },
    "fruit salad": { calories: 160, serving: "1.5 cups", protein: 2, carbs: 38, fats: 1 },
    "cheesecake": { calories: 420, serving: "1 slice", protein: 7, carbs: 34, fats: 28 },
    "chocolate cake": { calories: 390, serving: "1 slice", protein: 5, carbs: 55, fats: 16 },
    "ice cream": { calories: 200, serving: "1/2 cup", protein: 3, carbs: 24, fats: 10 },
    "brownie": { calories: 320, serving: "1 brownie", protein: 4, carbs: 44, fats: 14 },
    "donut": { calories: 260, serving: "1 donut", protein: 4, carbs: 34, fats: 12 },
  };

  if (overrides[name]) {
    return {
      ...overrides[name],
      note: "Estimated per typical serving.",
    };
  }

  let calories = 420;
  let serving = "1 serving";
  let split = { protein: 0.3, carbs: 0.4, fats: 0.3 };

  if (name.includes("salad")) {
    calories = 250;
    serving = "1 bowl";
    split = { protein: 0.2, carbs: 0.5, fats: 0.3 };
  } else if (name.includes("soup") || name.includes("bisque") || name.includes("chowder")) {
    calories = 220;
    serving = "1 bowl";
    split = { protein: 0.2, carbs: 0.5, fats: 0.3 };
  } else if (
    name.includes("cake") ||
    name.includes("cheesecake") ||
    name.includes("tiramisu") ||
    name.includes("panna cotta") ||
    name.includes("baklava") ||
    name.includes("creme brulee") ||
    name.includes("brownie") ||
    name.includes("cup cake")
  ) {
    calories = 360;
    serving = "1 slice";
    split = { protein: 0.08, carbs: 0.55, fats: 0.37 };
  } else if (name.includes("ice cream") || name.includes("frozen yogurt")) {
    calories = 200;
    serving = "1/2 cup";
    split = { protein: 0.08, carbs: 0.6, fats: 0.32 };
  } else if (name.includes("pizza")) {
    calories = 285;
    serving = "1 slice";
    split = { protein: 0.18, carbs: 0.45, fats: 0.37 };
  } else if (
    name.includes("sandwich") ||
    name.includes("burger") ||
    name.includes("hamburger") ||
    name.includes("hot dog") ||
    name.includes("club")
  ) {
    calories = 450;
    serving = "1 sandwich";
    split = { protein: 0.22, carbs: 0.45, fats: 0.33 };
  } else if (
    name.includes("spaghetti") ||
    name.includes("lasagna") ||
    name.includes("ravioli") ||
    name.includes("gnocchi") ||
    name.includes("risotto") ||
    name.includes("macaroni")
  ) {
    calories = 500;
    serving = "1.5 cups";
    split = { protein: 0.18, carbs: 0.55, fats: 0.27 };
  } else if (name.includes("rice")) {
    calories = 420;
    serving = "1.5 cups";
    split = { protein: 0.12, carbs: 0.68, fats: 0.2 };
  } else if (name.includes("curry")) {
    calories = 480;
    serving = "1 cup";
    split = { protein: 0.2, carbs: 0.45, fats: 0.35 };
  } else if (name.includes("fried") || name.includes("fries")) {
    calories = 420;
    serving = "1 serving";
    split = { protein: 0.1, carbs: 0.45, fats: 0.45 };
  } else if (
    name.includes("taco") ||
    name.includes("burrito") ||
    name.includes("quesadilla") ||
    name.includes("nachos")
  ) {
    calories = name.includes("burrito") ? 700 : 260;
    serving = name.includes("burrito") ? "1 burrito" : "1 item";
    split = { protein: 0.2, carbs: 0.5, fats: 0.3 };
  } else if (name.includes("sushi") || name.includes("sashimi")) {
    calories = name.includes("sashimi") ? 200 : 300;
    serving = name.includes("sashimi") ? "6 pieces" : "6 pieces";
    split = { protein: 0.3, carbs: 0.5, fats: 0.2 };
  } else if (
    name.includes("steak") ||
    name.includes("ribs") ||
    name.includes("prime rib") ||
    name.includes("pork chop") ||
    name.includes("filet")
  ) {
    calories = 600;
    serving = "8 oz";
    split = { protein: 0.4, carbs: 0.1, fats: 0.5 };
  } else if (
    name.includes("waffle") ||
    name.includes("pancake") ||
    name.includes("french toast")
  ) {
    calories = 350;
    serving = "2 pieces";
    split = { protein: 0.1, carbs: 0.6, fats: 0.3 };
  } else if (
    name.includes("dumpling") ||
    name.includes("gyoza") ||
    name.includes("samosa") ||
    name.includes("spring roll")
  ) {
    calories = 320;
    serving = "6 pieces";
    split = { protein: 0.15, carbs: 0.5, fats: 0.35 };
  } else if (
    name.includes("salmon") ||
    name.includes("shrimp") ||
    name.includes("scallop") ||
    name.includes("mussels") ||
    name.includes("oyster") ||
    name.includes("tuna") ||
    name.includes("crab") ||
    name.includes("lobster")
  ) {
    calories = 350;
    serving = "6 oz";
    split = { protein: 0.45, carbs: 0.1, fats: 0.45 };
  }

  const macros = calculateMacros(calories, split);

  return {
    calories,
    serving,
    ...macros,
    note: "Estimated per typical serving.",
  };
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

    const nutrition = estimateNutrition(top.label);
    const displayLabel = formatFoodLabel(top.label);

    return res.json({
      food: displayLabel,
      calories: nutrition.calories,
      protein: nutrition.protein,
      carbs: nutrition.carbs,
      fats: nutrition.fats,
      serving: nutrition.serving,
      calorieNote: nutrition.note,
      model,
      highConfidence,
      confidence,
      warning: highConfidence ? null : "Low confidence prediction.",
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
