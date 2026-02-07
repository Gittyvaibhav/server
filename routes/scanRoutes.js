const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { scanFood } = require("../controllers/foodController");
const auth = require("../middleware/auth");

const router = express.Router();

const useMemoryStorage = Boolean(process.env.VERCEL);

const storage = useMemoryStorage
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, "../../uploads");
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
      },
    });

const upload = multer({ storage });

router.post("/", auth, upload.single("image"), scanFood);

module.exports = router;
