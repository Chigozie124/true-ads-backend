import { auth, db } from "../config/firebaseAdmin.js";

export default function authGuard(roles = []) {
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization?.split("Bearer ")[1];
      if (!token) return res.status(401).json({ error: "No token" });

      const decoded = await auth.verifyIdToken(token);
      const snap = await db.collection("users").doc(decoded.uid).get();

      if (!snap.exists) return res.status(403).json({ error: "User not found" });

      const user = snap.data();

      if (user.banned) {
        return res.status(403).json({ error: "Account banned" });
      }

      if (roles.length && !roles.includes(user.role)) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      req.user = { uid: decoded.uid, ...user };
      next();
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  };
}
