const jwt = require("jsonwebtoken");
const User = require("../models/User");

const signToken = (userId) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const err = new Error("JWT secret not configured");
    err.status = 500;
    throw err;
  }
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign({ id: userId }, secret, { expiresIn });
};

const formatUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
});

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, and password are required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password: String(password),
    });

    const token = signToken(user._id);
    return res.status(201).json({ token, user: formatUser(user) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || "Registration failed" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select("+password");
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const match = await user.comparePassword(String(password));
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user._id);
    return res.json({ token, user: formatUser(user) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || "Login failed" });
  }
};

exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({ user: formatUser(user) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load user" });
  }
};
