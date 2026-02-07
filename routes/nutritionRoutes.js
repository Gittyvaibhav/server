const express = require("express");
const { createProfile, generateAIDietPlan } = require("../controllers/nutritionController");
const auth = require("../middleware/auth");

const router = express.Router();

router.post("/profile", auth, createProfile);
router.post("/generate-plan", auth, generateAIDietPlan);

module.exports = router;
