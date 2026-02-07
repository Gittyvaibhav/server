const mongoose = require("mongoose");

const progressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: Date, default: Date.now },
  weight: Number,
  notes: String,
});

module.exports = mongoose.model("Progress", progressSchema);
