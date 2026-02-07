const express = require("express");
const cors = require("cors");
const nutritionRoutes = require("./routes/nutritionRoutes");


const app = express();

/* ----------- MIDDLEWARE ----------- */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ----------- ROUTES ----------- */
const safeUse = (mountPath, routePath) => {
  try {
    const router = typeof routePath === "string" ? require(routePath) : routePath;
    app.use(mountPath, router);
  } catch (err) {
    console.error(`Route loading error for ${mountPath}:`, err);
  }
};

safeUse("/api/nutrition", nutritionRoutes);
safeUse("/api/users", "./routes/userRoutes");
safeUse("/api/food", "./routes/foodRoutes");
safeUse("/api/scan", "./routes/scanRoutes");
safeUse("/api/workout", "./routes/workoutRoutes");

/* ----------- TEST ROUTE ----------- */
app.get("/", (req, res) => {
  res.json({ status: "API working", timestamp: new Date().toISOString() });
});

/* ----------- ERROR HANDLER ----------- */
app.use((err, req, res, next) => {
  console.error("Express error:", err.message);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    path: req.path,
  });
});

/* ----------- 404 HANDLER ----------- */
app.use((req, res) => {
  res.status(404).json({ error: "Route not found", path: req.path });
});

/* ----------- PROCESS ERROR HANDLERS ----------- */
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

module.exports = app;
