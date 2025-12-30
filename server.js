// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin SDK
// Make sure you have your serviceAccountKey.json downloaded
import serviceAccount from "./serviceAccountKey.json" assert { type: "json" };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const PORT = process.env.PORT || 3000;

// 🔐 Paystack mode
const MODE = process.env.PAYSTACK_MODE || "test";

// 🔐 Keys selector
const PAYSTACK_SECRET_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_SECRET_KEY
    : process.env.PAYSTACK_TEST_SECRET_KEY;

const PAYSTACK_PUBLIC_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_PUBLIC_KEY
    : process.env.PAYSTACK_TEST_PUBLIC_KEY;

if (!PAYSTACK_SECRET_KEY) {
  console.error("❌ Paystack secret key missing");
}

// ===============================
// Initialize Payment
// ===============================
app.post("/pay/initiate", async (req, res) => {
  try {
    const { email, amount, purpose } = req.body;
    if (!amount || !purpose) {
      return res.status(400).json({ status: false, message: "Amount and purpose required" });
    }

    const finalEmail = email || process.env.DEFAULT_EMAIL || "user@example.com";
    const finalAmount = amount; // in kobo

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: finalEmail,
        amount: finalAmount,
        metadata: { purpose }
      })
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json(data);
    }

    res.json({
      status: true,
      reference: data.data.reference,
      email: finalEmail,
      amount: finalAmount,
      publicKey: PAYSTACK_PUBLIC_KEY
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Payment initiation failed" });
  }
});

// ===============================
// Paystack Webhook
// ===============================
app.post("/pay/webhook", async (req, res) => {
  try {
    const event = req.body;

    // 🔹 Verify signature (optional but recommended)
    // const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest('hex');
    // if (hash !== req.headers['x-paystack-signature']) return res.status(400).send('Invalid signature');

    if (event.event === "charge.success") {
      const { amount, metadata, customer } = event.data;
      const purpose = metadata?.purpose || "wallet";
      const email = customer?.email;

      // Find user by email in Firestore
      const usersRef = db.collection("users");
      const snapshot = await usersRef.where("email", "==", email).get();
      if (!snapshot.empty) {
        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();

        if (purpose === "wallet") {
          const currentBalance = userData.balance || 0;
          await userDoc.ref.update({ balance: currentBalance + amount / 100 });
          console.log(`✅ Wallet updated for ${email}, +₦${amount / 100}`);
        } else if (purpose === "upgrade") {
          await userDoc.ref.update({ isSeller: true });
          console.log(`✅ User ${email} upgraded to seller`);
        }

        // Optional: log transaction
        await db.collection("transactions").add({
          userId: userDoc.id,
          email,
          purpose,
          amount: amount / 100,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          reference: event.data.reference
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Server error");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT} (${MODE} mode)`);
});
