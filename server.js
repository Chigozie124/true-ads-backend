import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}
const db = admin.firestore();

// 🔹 Paystack mode & keys
const MODE = process.env.PAYSTACK_MODE || "test";

const PAYSTACK_SECRET_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_SECRET_KEY
    : process.env.PAYSTACK_TEST_SECRET_KEY;

const PAYSTACK_PUBLIC_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_PUBLIC_KEY
    : process.env.PAYSTACK_TEST_PUBLIC_KEY;

if (!PAYSTACK_SECRET_KEY) console.error("❌ Paystack secret key missing");

// ===============================
// 🔹 Initiate payment (upgrade or wallet)
// ===============================
app.post("/pay/initiate", async (req, res) => {
  try {
    const { email, amount, purpose } = req.body;
    if (!amount || !email || !purpose)
      return res.status(400).json({ status: false, message: "Missing data" });

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount,
          metadata: { purpose },
        }),
      }
    );

    const data = await response.json();

    if (!data.status) return res.status(400).json(data);

    res.json({
      status: true,
      reference: data.data.reference,
      email,
      amount,
      publicKey: PAYSTACK_PUBLIC_KEY,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Payment initiation failed" });
  }
});

// ===============================
// 🔹 Verify payment
// ===============================
app.post("/pay/verify", async (req, res) => {
  try {
    const { reference, uid, purpose } = req.body;
    if (!reference || !uid || !purpose)
      return res.status(400).json({ status: false, message: "Missing data" });

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await response.json();
    if (!data.status)
      return res.status(400).json({ status: false, message: "Payment failed" });

    // 🔹 Update Firestore based on purpose
    const userRef = db.collection("users").doc(uid);

    if (purpose === "upgrade") {
      await userRef.update({ isSeller: true });
    } else if (purpose === "wallet") {
      const snap = await userRef.get();
      const current = snap.exists && snap.data().balance ? snap.data().balance : 0;
      await userRef.update({ balance: current + parseInt(data.data.amount) });
    }

    res.json({ status: true, message: "Payment verified and updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Verification failed" });
  }
});

// ===============================
// 🔹 Future placeholder endpoints
// ===============================
app.post("/withdraw", (req, res) => {
  // Example: check user balance, initiate payout, log transaction
  res.json({ status: true, message: "Withdraw endpoint ready" });
});

app.post("/purchase", (req, res) => {
  // Example: purchase item, deduct balance, log transaction
  res.json({ status: true, message: "Purchase endpoint ready" });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Backend running on port ${process.env.PORT || 3000} (${MODE} mode)`);
});
