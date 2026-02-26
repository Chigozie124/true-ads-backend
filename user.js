import express from "express";
import { ESCROW_DB, ESCROW_AUTH, ESCROW_FIELD } from "./firebase.js";
import verifyToken from "./middleware-auth.js"; // token verification middleware
import ensureUserData from "./ensureUserData.js"; // auto-create wallet & defaults

const router = express.Router();

/* ===== SIGNUP ===== */
router.post("/signup", async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    const userRecord = await ESCROW_AUTH.createUser({ email, password, displayName: fullName });

    // Set default role: user
    await ESCROW_AUTH.setCustomUserClaims(userRecord.uid, { role: "user", banned: false });

    // Auto-create wallet & profile in Firestore
    await ensureUserData(userRecord.uid);

    res.json({ uid: userRecord.uid, email: userRecord.email, fullName });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(400).json({ error: err.message });
  }
});

/* ===== LOGIN ===== */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // In Firebase Auth client SDK, login is usually done via frontend
    res.json({ message: "Use Firebase client SDK for login" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(400).json({ error: err.message });
  }
});

/* ===== GET USER PROFILE ===== */
router.get("/profile", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const doc = await ESCROW_DB.collection("USERS").doc(uid).get();

    if (!doc.exists) return res.status(404).json({ error: "User not found" });

    const user = doc.data();
    res.json({ uid, ...user });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
