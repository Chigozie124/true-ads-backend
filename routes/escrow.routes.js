import express from "express";
import middleware from "../middleware-auth.js";
import { db } from "../firebaseAdmin.js";
import { initPayment } from "../paystack.js";

const router = express.Router();

router.post("/create", middleware, async (req, res) => {
  const { amount } = req.body;
  const reference = `escrow_${Date.now()}`;

  await db.collection("escrows").doc(reference).set({
    buyer: req.user.uid,
    amount,
    status: "pending",
    createdAt: Date.now(),
  });

  const url = await initPayment(req.user.email, amount, reference);
  res.json({ paymentUrl: url });
});

export default router;
