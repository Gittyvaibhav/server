const path = require("path");

// Load .env only in local development
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
}

const app = require("./app");
const connectDb = require("./db");

const PORT = process.env.PORT || 5000;

const start = async () => {
  try {
    await connectDb();
    console.log("MongoDB Connected");

    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    server.on("error", (err) => {
      console.error("Server error:", err);
    });

    process.on("SIGTERM", () => {
      console.log("SIGTERM received. Shutting down...");
      server.close(() => {
        console.log("Process terminated");
      });
    });

  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  }
};

start();
