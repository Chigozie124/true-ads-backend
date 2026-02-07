import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

router.post("/open", async (req, res) => {
  await db.collection("disputes").add({
    ...req.body,
    status: "open",
    createdAt: Date.now(),
  });
  res.json({ success: true });
});

export default router;
