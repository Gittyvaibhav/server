const path = require("path");

if (!process.env.VERCEL) {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
}

const app = require("./app");
const connectDb = require("./db");

/* ----------- DATABASE CONNECTION & SERVER START ----------- */
const PORT = process.env.PORT || 5000;

const start = async () => {
  try {
    await connectDb();
    console.log("MongoDB Connected");

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
      console.log(`   -> http://localhost:${PORT}`);
      console.log(`   -> http://127.0.0.1:${PORT}`);
    });

    server.on("error", (err) => {
      console.error("Server error:", err);
    });

    // Keep server alive
    process.on("SIGINT", async () => {
      console.log("\nShutting down gracefully...");
      await connectDb.disconnect();
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
    });
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  }
};

start();
