const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const {
  saveWorkout,
  getWorkouts,
  generateAIWorkoutPlan,
  getWorkoutPlans,
  renameWorkoutPlan,
  toggleFavoriteWorkoutPlan,
  deleteWorkoutPlan,
  startSession,
  updateSession,
  completeSession,
} = require("../controllers/workoutController");

router.use(auth);

router.post("/", saveWorkout);
router.get("/", getWorkouts);

// AI workout plan
router.post("/ai-plan", generateAIWorkoutPlan);
router.get("/ai-plans", getWorkoutPlans);
router.patch("/ai-plans/:id", renameWorkoutPlan);
router.patch("/ai-plans/:id/favorite", toggleFavoriteWorkoutPlan);
router.delete("/ai-plans/:id", deleteWorkoutPlan);

// Real-time session routes
router.post("/session", startSession);
router.patch("/session/:sessionId", updateSession);
router.post("/session/:sessionId/complete", completeSession);

module.exports = router;
