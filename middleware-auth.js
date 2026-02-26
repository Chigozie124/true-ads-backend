import { admin } from "./firebase.js";

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split("Bearer ")[1];

    const decoded = await admin.auth().verifyIdToken(token);

    req.user = decoded; // contains uid + email

    next();
  } catch (err) {
    console.error("Token Error:", err);
    res.status(401).json({ error: "Invalid token" });
  }
};

export default verifyToken;
