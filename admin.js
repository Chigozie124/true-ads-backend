import express from "express";
import { ESCROW_DB, ESCROW_FIELD } from "./firebase.js";

const router = express.Router();

router.post("/release/:id", async (req, res) => {
  const id = req.params.id;

  const escrowRef = ESCROW_DB.collection("ESCROW").doc(id);
  const escrow = (await escrowRef.get()).data();

  await escrowRef.update({ status: "RELEASED" });

  await ESCROW_DB.collection("ESCROW_USER")
    .doc(escrow.sellerId)
    .update({
      balance: ESCROW_FIELD.increment(escrow.amount)
    });

  res.json({ success: true });
});

router.post("/refund/:id", async (req, res) => {
  const id = req.params.id;

  await ESCROW_DB.collection("ESCROW")
    .doc(id)
    .update({ status: "REFUNDED" });

  res.json({ success: true });
});

export default router;
