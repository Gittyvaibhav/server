const express = require("express");
const router = express.Router();
const { createProfile, generateAIDietPlan } = require("../controllers/nutritionController");

router.post("/profile", createProfile);
router.post("/generate-plan", generateAIDietPlan);

module.exports = router;
