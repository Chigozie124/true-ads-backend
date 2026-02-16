import express from "express";
import ESCROW_AUTH_MIDDLEWARE from "./auth.js";
import { ESCROW_DB } from "./firebase.js";
import { ESCROW_PAYMENT } from "./paystack.js";
import { ESCROW_FRAUD_SCORE } from "./fraud.js";

const router = express.Router();

router.post("/create", ESCROW_AUTH_MIDDLEWARE, async (req, res) => {
  const { sellerId, amount } = req.body;
  const buyerId = req.ESCROW_USER.uid;

  const escrowId = "escrow_" + Date.now();
  const fraudScore = ESCROW_FRAUD_SCORE(amount);

  await ESCROW_DB.collection("ESCROW").doc(escrowId).set({
    escrowId,
    buyerId,
    sellerId,
    amount,
    fraudScore,
    status: "PENDING",
    createdAt: Date.now()
  });

  const paymentUrl = await ESCROW_PAYMENT(
    req.ESCROW_USER.email,
    amount,
    escrowId
  );

  res.json({ escrowId, paymentUrl });
});

export default router;
