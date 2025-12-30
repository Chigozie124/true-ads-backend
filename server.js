// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- FIREBASE ----------------
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK))
});
const db = getFirestore();

// ---------------- PAYSTACK ----------------
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

const PORT = process.env.PORT || 3000;

// ===============================
// Initiate Payment
// ===============================
app.post("/pay/initiate", async (req, res) => {
  try {
    const { email, amount, purpose, uid } = req.body;

    if (!email || !amount || !purpose || !uid)
      return res.status(400).json({ status: false, message: "Missing required fields" });

    // Create Paystack transaction
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount, // kobo
        metadata: { purpose, uid },
      }),
    });

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
// Verify Payment
// ===============================
app.post("/pay/verify", async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ status: false, message: "No reference provided" });

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const data = await response.json();

    if (!data.status || data.data.status !== "success")
      return res.status(400).json({ status: false, message: "Payment not successful" });

    const { metadata, amount, customer } = data.data;
    const { purpose, uid } = metadata;

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: false, message: "User not found" });

    const userData = userSnap.data();

    // Handle different payment purposes
    if (purpose === "wallet") {
      const newBalance = (userData.balance || 0) + amount / 100;
      await userRef.update({ balance: newBalance });

      // Log transaction
      await db.collection("transactions").add({
        uid,
        type: "wallet",
        amount: amount / 100,
        reference,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    if (purpose === "upgrade") {
      await userRef.update({ isSeller: true });

      // Log transaction
      await db.collection("transactions").add({
        uid,
        type: "upgrade",
        amount: amount / 100,
        reference,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    res.json({ status: true, message: "Payment verified and processed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Payment verification failed" });
  }
});

// ===============================
// Withdraw Request
// ===============================
app.post("/withdraw", async (req, res) => {
  try {
    const { uid, amount, accountNumber, bankName } = req.body;
    if (!uid || !amount || !accountNumber || !bankName)
      return res.status(400).json({ status: false, message: "Missing required fields" });

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: false, message: "User not found" });

    const userData = userSnap.data();
    if ((userData.balance || 0) < amount)
      return res.status(400).json({ status: false, message: "Insufficient balance" });

    // Deduct balance
    await userRef.update({ balance: userData.balance - amount });

    // Log withdrawal
    await db.collection("transactions").add({
      uid,
      type: "withdrawal",
      amount,
      accountNumber,
      bankName,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    res.json({ status: true, message: "Withdrawal request logged successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Withdrawal failed" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT} (${MODE} mode)`);
});
