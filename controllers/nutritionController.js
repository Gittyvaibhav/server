const UserProfile = require("../models/UserProfile");
const { InferenceClient } = require("@huggingface/inference");
const { jsonrepair } = require("jsonrepair");

const calculateCalories = (weight, height, age, gender, activity, goal) => {
  let bmr;

  if (gender === "male") {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  }

  const activityMap = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };

  let maintenance = bmr * activityMap[activity];

  if (goal === "cut") maintenance -= 500;
  if (goal === "bulk") maintenance += 400;

  return Math.round(maintenance);
};

exports.createProfile = async (req, res) => {
  const { weight, height, age, gender, activityLevel, goal } = req.body;

  const targetCalories = calculateCalories(
    weight,
    height,
    age,
    gender,
    activityLevel,
    goal
  );

  const profile = new UserProfile({
    weight,
    height,
    age,
    gender,
    activityLevel,
    goal,
    targetCalories,
  });

  await profile.save();

  res.json(profile);
};

// 🤖 AI DIET PLAN GENERATION USING HUGGING FACE
exports.generateAIDietPlan = async (req, res) => {
  try {
    const { weight, height, age, gender, activityLevel, goal, provider, model: requestedModel } = req.body;

    // Validate input
    if (!weight || !height || !age || !gender || !activityLevel || !goal) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (provider && provider !== "huggingface") {
      return res.status(400).json({ error: "Unsupported provider", details: provider });
    }

    // Check if Hugging Face token exists
    if (!process.env.HF_TOKEN) {
      return res.status(400).json({
        error: "Hugging Face token not configured",
        message: "Please set HF_TOKEN in .env file"
      });
    }

    // Enforce explicit model (no fallback)
    if (!process.env.HF_MODEL && !requestedModel) {
      return res.status(400).json({
        error: "Hugging Face model not configured",
        message: "Please set HF_MODEL in .env file or pass model in the request body"
      });
    }

    // Calculate calories first
    const targetCalories = calculateCalories(
      weight,
      height,
      age,
      gender,
      activityLevel,
      goal
    );

    console.log(`🤖 Generating AI diet plan for ${gender}, ${age}y, ${weight}kg, goal: ${goal}`);

    // Initialize Hugging Face client
    const client = new InferenceClient(process.env.HF_TOKEN);
    const model = requestedModel || process.env.HF_MODEL;

    const prompt = `You are a professional nutritionist and fitness expert.

Create a detailed, personalized 7-day diet plan for a client with these stats:
- Age: ${age} years
- Weight: ${weight} kg
- Height: ${height} cm
- Gender: ${gender}
- Activity Level: ${activityLevel}
- Goal: ${goal}
- Target Calories: ${targetCalories} kcal/day

Return ONLY a valid JSON object with NO markdown formatting, NO extra text, NO backticks. Exactly this structure:
{
  "summary": "Brief summary of the plan (2-3 sentences)",
  "dailyCalories": ${targetCalories},
  "macroTargets": {
    "protein": number (in grams),
    "carbs": number (in grams),
    "fats": number (in grams)
  },
  "meals": [
    {
      "day": "Day 1",
      "breakfast": "meal description",
      "breakfast_calories": number,
      "lunch": "meal description",
      "lunch_calories": number,
      "dinner": "meal description",
      "dinner_calories": number,
      "snacks": "snack description",
      "snacks_calories": number,
      "daily_total": number
    }
  ],
  "tips": ["tip 1", "tip 2", "tip 3", "tip 4", "tip 5"]
}

Make meals realistic, practical, and aligned with the goal (cut/bulk/maintain).
For cutting: reduce calories, high protein, lower carbs.
For bulking: increase calories, balanced macros, high protein.
For maintaining: moderate calories, balanced macros.

Return ONLY valid JSON, nothing else.`;

    let responseText = "";
    const lowerModel = (model || "").toLowerCase();
    const useTextGeneration =
      lowerModel.includes("gpt2") ||
      lowerModel.includes("t5") ||
      lowerModel.includes("flan");

    if (useTextGeneration) {
      const generation = await client.textGeneration({
        model,
        inputs: prompt,
        parameters: { max_new_tokens: 1200, temperature: 0.4 }
      });
      responseText = generation?.generated_text || "";
    } else {
      const completion = await client.chatCompletion({
        model,
        messages: [
          { role: "system", content: "You are a professional nutritionist and fitness expert." },
          { role: "user", content: prompt }
        ],
        max_tokens: 1200,
        temperature: 0.4
      });
      responseText =
        completion?.choices?.[0]?.message?.content ||
        completion?.choices?.[0]?.delta?.content ||
        "";
    }
    console.log("✓ Hugging Face response received");

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in Hugging Face response");
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      // Attempt to repair common JSON issues from LLM output
      const repaired = jsonrepair(jsonMatch[0]);
      parsed = JSON.parse(repaired);
    }
    console.log("✓ Parsed diet plan successfully");
    return res.json(parsed);

  } catch (err) {
    console.error("❌ Error generating diet plan:", err);
    const status = err?.response?.status || err?.status;
    const details = err?.response?.data || err?.message || "Unknown error";

    let userMessage = "Hugging Face inference failed. Please try again.";
    if (status === 401 || status === 403) {
      userMessage = "Hugging Face rejected the request. Check HF_TOKEN and model access (gated models require accepting terms).";
    } else if (status === 404) {
      userMessage = "Hugging Face model not found. Verify HF_MODEL is correct.";
    } else if (status === 429) {
      userMessage = "Hugging Face rate limit reached. Please wait and try again.";
    } else if (status === 503) {
      userMessage = "Hugging Face provider is unavailable. Try again in a few minutes.";
    }
    res.status(500).json({ 
      error: "Failed to generate diet plan from Hugging Face",
      message: userMessage,
      status,
      details
    });
  }
};
