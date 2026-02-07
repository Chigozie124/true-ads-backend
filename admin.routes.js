import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

router.post("/ban", async (req, res) => {
  await db.collection("users").doc(req.body.uid).update({ isBanned: true });
  res.json({ success: true });
});

export default router;
