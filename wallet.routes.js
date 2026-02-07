import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

router.post("/add", async (req, res) => {
  const { uid, amount } = req.body;
  if (amount < 100) return res.status(400).json({ error: "Min ₦100" });

  await db.collection("users").doc(uid).update({
    wallet: admin.firestore.FieldValue.increment(amount),
  });
  res.json({ success: true });
});

export default router;
