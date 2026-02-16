import { ESCROW_AUTH } from "./firebase.js";

export default async function ESCROW_AUTH_MIDDLEWARE(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });

    const decoded = await ESCROW_AUTH.verifyIdToken(token);
    req.ESCROW_USER = decoded;

    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
