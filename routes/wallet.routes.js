import express from "express";
import middleware from "../middleware-auth.js";
import { db } from "../firebaseAdmin.js";

const router = express.Router();

router.get("/", middleware, async (req, res) => {
  const snap = await db.collection("users").doc(req.user.uid).get();
  res.json(snap.data());
});

export default router;
