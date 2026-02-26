import express from "express";
import crypto from "crypto";
import { ESCROW_DB, ESCROW_FIELD } from "./firebase.js";

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;

/* ===== PAYSTACK WEBHOOK ===== */
router.post("/paystack", async (req, res) => {
  try {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET)
      .update(req.rawBody)
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(400).send("Invalid signature");
    }

    const event = req.body;

    if (event.event === "charge.success") {
      const { reference, amount, customer } = event.data;

      // Find escrow by reference
      const snapshot = await ESCROW_DB.collection("ESCROWS")
        .where("id", "==", reference)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        await doc.ref.update({
          status: "FUNDED",
          fundedAt: Date.now(),
        });

        // Credit buyer wallet
        await ESCROW_DB.collection("WALLETS").doc(customer.id).update({
          balance: ESCROW_FIELD.increment(amount / 100), // Paystack uses kobo
        });
      }
    }

    res.json({ status: "ok" });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
