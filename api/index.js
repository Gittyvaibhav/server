const app = require("../app");
const connectDb = require("../db");

module.exports = async (req, res) => {
  try {
    await connectDb();
    return app(req, res);
  } catch (err) {
    console.error("API handler error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
