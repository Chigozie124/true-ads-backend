import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

/* ================= SIGNUP ================= */
router.post("/signup", async (req, res) => {
  const { uid, email, fullName } = req.body;

  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      email,
      fullName: fullName || "",
      role: "buyer",
      banned: false,
      wallet: 0,
      createdAt: Date.now(),
    });
  }
  res.json({ success: true });
});

/* ================= LOGIN ================= */
router.post("/login", async (req, res) => {
  const { uid } = req.body;
  const userDoc = await db.collection("users").doc(uid).get();

  if (!userDoc.exists) return res.status(404).json({ error: "User missing" });
  if (userDoc.data().banned)
    return res.status(403).json({ error: "Account banned" });

  res.json({ success: true, user: userDoc.data() });
});

/* ================= USER PROFILE ================= */
router.get("/profile", async (req, res) => {
  // For now, get user ID from query (frontend can send ?uid=UID)
  const uid = req.query.uid;
  if (!uid) return res.status(400).json({ error: "UID required" });

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    res.json(userDoc.data());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

export default router;
