import express from "express";
import ESCROW_AUTH_MIDDLEWARE from "./auth.js";
import { ESCROW_DB, ESCROW_FIELD } from "./firebase.js";

const router = express.Router();

router.post("/request", ESCROW_AUTH_MIDDLEWARE, async (req, res) => {
  const { amount } = req.body;

  const userRef = ESCROW_DB.collection("ESCROW_USER")
    .doc(req.ESCROW_USER.uid);

  const user = (await userRef.get()).data();

  if (!user || user.balance < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  await userRef.update({
    balance: ESCROW_FIELD.increment(-amount)
  });

  await ESCROW_DB.collection("ESCROW_WITHDRAW").add({
    uid: req.ESCROW_USER.uid,
    amount,
    status: "PENDING",
    createdAt: Date.now()
  });

  res.json({ success: true });
});

export default router;
