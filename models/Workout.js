const mongoose = require("mongoose");

const workoutSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  exercise: {
    type: String,
    required: true,
  },
  reps: {
    type: Number,
    default: 0,
  },
  duration: {
    type: Number,
    default: 0,
  },
  // Optional session id for real-time updates
  sessionId: {
    type: String,
  },
  // status: active | completed
  status: {
    type: String,
    enum: ["active", "completed"],
    default: "completed",
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Workout", workoutSchema);
