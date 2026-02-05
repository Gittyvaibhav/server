const Workout = require("../models/Workout");
const WorkoutPlan = require("../models/WorkoutPlan");
const { InferenceClient } = require("@huggingface/inference");
const { jsonrepair } = require("jsonrepair");

const ALLOWED_GOALS = [
  "fat loss",
  "muscle gain",
  "strength",
  "general fitness",
  "endurance",
  "maintenance",
];

const GOAL_ALIASES = {
  cut: "fat loss",
  bulk: "muscle gain",
  maintain: "maintenance",
};

const ALLOWED_EXPERIENCE = ["beginner", "intermediate", "advanced"];

const ALLOWED_EQUIPMENT = [
  "full gym",
  "home",
  "bodyweight",
  "dumbbells",
  "bands",
  "kettlebell",
  "barbell",
  "machines",
];

const ALLOWED_MUSCLE_GROUPS = [
  "full body",
  "chest",
  "back",
  "legs",
  "glutes",
  "shoulders",
  "arms",
  "biceps",
  "triceps",
  "core",
  "calves",
];

const normalize = (value) => String(value || "").trim().toLowerCase();

// POST: Save workout
exports.saveWorkout = async (req, res) => {
  try {
    const workout = new Workout(req.body);
    await workout.save();
    res.status(201).json(workout);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET: Get all workouts
exports.getWorkouts = async (req, res) => {
  try {
    const workouts = await Workout.find().sort({ date: -1 });
    res.json(workouts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// POST: Start a real-time session
exports.startSession = async (req, res) => {
  try {
    const { exercise } = req.body;
    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const workout = new Workout({ exercise, reps: 0, duration: 0, sessionId, status: 'active' });
    await workout.save();
    res.status(201).json(workout);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// PATCH: Update an active session by sessionId
exports.updateSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const updates = req.body; // e.g. { reps: 5, duration: 12 }
    const workout = await Workout.findOneAndUpdate({ sessionId }, { $set: updates }, { new: true });
    if (!workout) return res.status(404).json({ error: 'Session not found' });
    res.json(workout);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// POST: Complete session
exports.completeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const updates = { status: 'completed', ...req.body };
    const workout = await Workout.findOneAndUpdate({ sessionId }, { $set: updates }, { new: true });
    if (!workout) return res.status(404).json({ error: 'Session not found' });
    res.json(workout);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET: Get saved workout plans
exports.getWorkoutPlans = async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 && limit <= 100 ? limit : 20;

    const filter = {};
    if (req.query.goal) filter.goal = String(req.query.goal).toLowerCase();
    if (req.query.muscleGroup) {
      const raw = String(req.query.muscleGroup).toLowerCase();
      const groups = raw.split(",").map((g) => g.trim()).filter(Boolean);
      if (groups.length > 1) {
        filter.targetMuscleGroups = { $all: groups };
      } else if (groups.length === 1) {
        filter.targetMuscleGroups = groups[0];
      }
    }
    if (req.query.favorite === "true") filter.favorite = true;
    if (req.query.search) {
      filter.title = { $regex: String(req.query.search), $options: "i" };
    }

    const sort = {};
    if (req.query.sort === "favorites") {
      sort.favorite = -1;
    }
    sort.createdAt = -1;

    const total = await WorkoutPlan.countDocuments(filter);
    const plans = await WorkoutPlan.find(filter)
      .sort(sort)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit);

    res.json({
      data: plans,
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// PATCH: Rename a saved workout plan
exports.renameWorkoutPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const updated = await WorkoutPlan.findByIdAndUpdate(
      id,
      { $set: { title: String(title).trim() } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Plan not found" });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// PATCH: Toggle favorite on a saved plan
exports.toggleFavoriteWorkoutPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { favorite } = req.body;
    const nextValue =
      typeof favorite === "boolean" ? favorite : undefined;

    const updated = await WorkoutPlan.findByIdAndUpdate(
      id,
      nextValue === undefined ? { $bit: { favorite: { xor: 1 } } } : { $set: { favorite: nextValue } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Plan not found" });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// DELETE: Remove a saved workout plan
exports.deleteWorkoutPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await WorkoutPlan.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Plan not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🤖 AI WORKOUT PLAN GENERATION USING HUGGING FACE
exports.generateAIWorkoutPlan = async (req, res) => {
  try {
    const {
      goal,
      experienceLevel,
      daysPerWeek,
      equipment,
      timePerSession,
      targetMuscleGroups,
      injuries,
      title,
      provider,
      model: requestedModel,
    } = req.body;

    // Validate input
    if (!goal || !experienceLevel || !daysPerWeek || !equipment) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["goal", "experienceLevel", "daysPerWeek", "equipment"],
      });
    }

    if (provider && provider !== "huggingface") {
      return res.status(400).json({ error: "Unsupported provider", details: provider });
    }

    const normalizedGoal = GOAL_ALIASES[normalize(goal)] || normalize(goal);
    if (!ALLOWED_GOALS.includes(normalizedGoal)) {
      return res.status(400).json({
        error: "Invalid goal",
        allowed: ALLOWED_GOALS,
      });
    }

    const normalizedExperience = normalize(experienceLevel);
    if (!ALLOWED_EXPERIENCE.includes(normalizedExperience)) {
      return res.status(400).json({
        error: "Invalid experienceLevel",
        allowed: ALLOWED_EXPERIENCE,
      });
    }

    const normalizedEquipment = normalize(equipment);
    if (!ALLOWED_EQUIPMENT.includes(normalizedEquipment)) {
      return res.status(400).json({
        error: "Invalid equipment",
        allowed: ALLOWED_EQUIPMENT,
      });
    }

    const days = Number(daysPerWeek);
    if (!Number.isFinite(days) || days < 1 || days > 7) {
      return res.status(400).json({
        error: "Invalid daysPerWeek",
        allowed: "1-7",
      });
    }

    let normalizedMuscles = [];
    if (targetMuscleGroups) {
      const list = Array.isArray(targetMuscleGroups)
        ? targetMuscleGroups
        : String(targetMuscleGroups).split(",").map((item) => item.trim());
      normalizedMuscles = list.filter(Boolean).map(normalize);
      const invalid = normalizedMuscles.filter(
        (group) => !ALLOWED_MUSCLE_GROUPS.includes(group)
      );
      if (invalid.length) {
        return res.status(400).json({
          error: "Invalid targetMuscleGroups",
          invalid,
          allowed: ALLOWED_MUSCLE_GROUPS,
        });
      }
    }

    // Check if Hugging Face token exists
    if (!process.env.HF_TOKEN) {
      return res.status(400).json({
        error: "Hugging Face token not configured",
        message: "Please set HF_TOKEN in .env file",
      });
    }

    // Enforce explicit model (no fallback)
    if (!process.env.HF_MODEL && !requestedModel) {
      return res.status(400).json({
        error: "Hugging Face model not configured",
        message: "Please set HF_MODEL in .env file or pass model in the request body",
      });
    }

    console.log(
      `🤖 Generating AI workout plan | goal=${normalizedGoal} exp=${normalizedExperience} days=${days}`
    );

    // Initialize Hugging Face client
    const client = new InferenceClient(process.env.HF_TOKEN);
    const model = requestedModel || process.env.HF_MODEL;

    const prompt = `You are a certified strength & conditioning coach.

Create a personalized workout plan based on:
- Goal: ${normalizedGoal}
- Experience Level: ${normalizedExperience}
- Days per week: ${days}
- Equipment: ${normalizedEquipment}
- Time per session: ${timePerSession || "not specified"} minutes
- Target muscle groups: ${normalizedMuscles.length ? normalizedMuscles.join(", ") : "not specified"}
- Injuries or limitations: ${injuries || "none"}

Return ONLY a valid JSON object with NO markdown formatting, NO extra text, NO backticks. Exactly this structure:
{
  "summary": "2-3 sentence overview",
  "split": "e.g., Push/Pull/Legs, Upper/Lower, Full Body",
  "weeklySchedule": [
    {
      "day": "Day 1",
      "muscleFocus": "Primary muscle group(s)",
      "warmup": ["item 1", "item 2"],
      "exercises": [
        {
          "name": "exercise name",
          "sets": number,
          "reps": "rep range (e.g., 8-12)",
          "restSeconds": number,
          "notes": "optional form cue or progression"
        }
      ],
      "cardio": [
        {
          "type": "e.g., incline walk, cycling, rower, jump rope",
          "durationMinutes": number,
          "intensity": "low/moderate/high"
        }
      ],
      "cooldown": ["item 1", "item 2"]
    }
  ],
  "progressionTips": ["tip 1", "tip 2", "tip 3", "tip 4"]
}

Rules:
- Choose exercises that match the equipment and experience level.
- Include different exercises for different muscle groups across the week.
- Align with goal:
  - Fat loss: higher volume, moderate rest, compound + accessory, include cardio in each training day.
  - Muscle gain: progressive overload, 8-12 reps, moderate rest.
  - Strength: lower reps, longer rest, focus on main lifts.
- Target muscle groups should be used as primary focus across the week.
- Keep plan realistic for the time per session.

Return ONLY valid JSON.`;

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
        parameters: { max_new_tokens: 1100, temperature: 0.4 },
      });
      responseText = generation?.generated_text || "";
    } else {
      const completion = await client.chatCompletion({
        model,
        messages: [
          { role: "system", content: "You are a certified strength & conditioning coach." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1100,
        temperature: 0.4,
      });
      responseText =
        completion?.choices?.[0]?.message?.content ||
        completion?.choices?.[0]?.delta?.content ||
        "";
    }
    console.log("✓ Hugging Face response received (workout plan)");

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in Hugging Face response");
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      const repaired = jsonrepair(jsonMatch[0]);
      parsed = JSON.parse(repaired);
    }
    console.log("✓ Parsed workout plan successfully");
    const savedPlan = await WorkoutPlan.create({
      goal: normalizedGoal,
      experienceLevel: normalizedExperience,
      daysPerWeek: days,
      equipment: normalizedEquipment,
      timePerSession: timePerSession ? Number(timePerSession) : undefined,
      targetMuscleGroups: normalizedMuscles,
      injuries: injuries || "",
      model,
      title: (title && String(title).trim()) || `${normalizedGoal} • ${days} day plan`,
      plan: parsed,
    });

    return res.json({
      ...parsed,
      savedPlanId: savedPlan._id,
      savedAt: savedPlan.createdAt,
    });
  } catch (err) {
    console.error("❌ Error generating workout plan:", err);
    const status = err?.response?.status || err?.status;
    const details = err?.response?.data || err?.message || "Unknown error";

    let userMessage = "Hugging Face inference failed. Please try again.";
    if (status === 401 || status === 403) {
      userMessage =
        "Hugging Face rejected the request. Check HF_TOKEN and model access (gated models require accepting terms).";
    } else if (status === 404) {
      userMessage = "Hugging Face model not found. Verify HF_MODEL is correct.";
    } else if (status === 429) {
      userMessage = "Hugging Face rate limit reached. Please wait and try again.";
    } else if (status === 503) {
      userMessage = "Hugging Face provider is unavailable. Try again in a few minutes.";
    }
    res.status(500).json({
      error: "Failed to generate workout plan from Hugging Face",
      message: userMessage,
      status,
      details,
    });
  }
};
