import express from "express";
import { db, auth } from "./firebase.js";

const router = express.Router();

router.post("/signup", async (req, res) => {
  const { uid, email } = req.body;

  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      email,
      role: "buyer",
      isBanned: false,
      wallet: 0,
      createdAt: Date.now(),
    });
  }
  res.json({ success: true });
});

router.post("/login", async (req, res) => {
  const { uid } = req.body;
  const userDoc = await db.collection("users").doc(uid).get();

  if (!userDoc.exists) return res.status(404).json({ error: "User missing" });
  if (userDoc.data().isBanned)
    return res.status(403).json({ error: "Account banned" });

  res.json({ success: true, user: userDoc.data() });
});

export default router;
