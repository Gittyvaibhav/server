const mongoose = require("mongoose");

const UserProfileSchema = new mongoose.Schema({
  weight: Number,
  height: Number,
  age: Number,
  gender: String,
  activityLevel: String,
  goal: String,
  targetCalories: Number,
});

module.exports = mongoose.model("UserProfile", UserProfileSchema);
