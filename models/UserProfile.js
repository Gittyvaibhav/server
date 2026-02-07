const mongoose = require("mongoose");

const UserProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  weight: Number,
  height: Number,
  age: Number,
  gender: String,
  activityLevel: String,
  goal: String,
  targetCalories: Number,
});

module.exports = mongoose.model("UserProfile", UserProfileSchema);
