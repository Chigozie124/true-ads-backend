import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

router.post("/send", async (req, res) => {
  await db.collection("chats").add({
    ...req.body,
    createdAt: Date.now(),
  });
  res.json({ success: true });
});

export default router;
