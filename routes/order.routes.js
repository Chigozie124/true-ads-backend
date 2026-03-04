import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

router.post("/create", async (req, res) => {
  const order = {
    ...req.body,
    status: "escrow",
    createdAt: Date.now(),
  };
  const ref = await db.collection("orders").add(order);
  res.json({ orderId: ref.id });
});

export default router;
