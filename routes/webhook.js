import express from "express";
import crypto from "crypto";
import { db, FieldValue } from "./firebase.js";

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;

/* ===============================
   PAYSTACK WEBHOOK
================================= */
router.post("/paystack", async (req, res) => {
  try {
    if (!PAYSTACK_SECRET) {
      console.error("Missing PAYSTACK_SECRET");
      return res.status(500).send("Server config error");
    }

    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET)
      .update(req.rawBody)
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(400).send("Invalid signature");
    }

    const event = req.body;

    /* ===============================
       PAYMENT SUCCESS
    ================================= */
    if (event.event === "charge.success") {
      const { reference, amount, customer } = event.data;

      // Find escrow using ID (reference must equal escrowId)
      const escrowRef = db.collection("ESCROWS").doc(reference);
      const escrowDoc = await escrowRef.get();

      if (!escrowDoc.exists) {
        return res.json({ status: "escrow_not_found" });
      }

      const escrow = escrowDoc.data();

      // Prevent double funding
      if (escrow.status === "FUNDED") {
        return res.json({ status: "already_funded" });
      }

      // 1️⃣ Update escrow
      await escrowRef.update({
        status: "FUNDED",
        fundedAt: Date.now(),
      });

      // 2️⃣ Credit buyer wallet (Paystack sends kobo)
      const buyerWalletRef = db.collection("ESCROW_USER").doc(escrow.buyerId);

      await buyerWalletRef.update({
        balance: FieldValue.increment(amount / 100)
      });
    }

    return res.json({ status: "ok" });

  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({
      success: false,
      error: "Webhook processing failed"
    });
  }
});

export default router;
