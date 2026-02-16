import { auth } from "./firebaseAdmin.js";

export default async function (req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).send("No token");

    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch {
    res.status(401).send("Invalid token");
  }
}
