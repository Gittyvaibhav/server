const mongoose = require("mongoose");

const workoutPlanSchema = new mongoose.Schema(
  {
    goal: { type: String, required: true },
    experienceLevel: { type: String, required: true },
    daysPerWeek: { type: Number, required: true },
    equipment: { type: String, required: true },
    timePerSession: { type: Number },
    targetMuscleGroups: { type: [String], default: [] },
    injuries: { type: String, default: "" },
    title: { type: String, default: "" },
    favorite: { type: Boolean, default: false },
    model: { type: String },
    plan: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WorkoutPlan", workoutPlanSchema);
