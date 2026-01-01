// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* -------------------- Firebase Admin Init -------------------- */

const __dirname = path.resolve();

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "firebase-admin.json"), "utf8")
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

/* -------------------- Paystack Config -------------------- */

const PAYSTACK_SECRET =
  process.env.PAYSTACK_LIVE_SECRET_KEY ||
  process.env.PAYSTACK_TEST_SECRET_KEY;

if (!PAYSTACK_SECRET) {
  throw new Error("❌ Paystack secret key not found in env");
}

/* -------------------- Helpers -------------------- */

function verifyUser(req, res, next) {
  const uid = req.headers["x-user-id"];
  if (!uid) return res.status(401).json({ error: "Unauthorized" });
  req.uid = uid;
  next();
}

/* -------------------- INIT PAYMENT -------------------- */
/*
  Used for:
  - Add money
  - Seller upgrade
*/
app.post("/pay/init", verifyUser, async (req, res) => {
  try {
    const { amount, purpose } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const userDoc = await db.collection("users").doc(req.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userDoc.data();

    const reference = `trueads_${Date.now()}_${req.uid}`;

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: user.email,
        amount: amount * 100, // Paystack uses kobo
        reference,
        metadata: {
          uid: req.uid,
          purpose, // "add_money" | "upgrade"
        },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      authorization_url: response.data.data.authorization_url,
      reference,
    });
  } catch (err) {
    console.error("INIT PAYMENT ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "Error starting payment" });
  }
});

/* -------------------- PAYSTACK WEBHOOK -------------------- */
/*
  This is where REAL money is confirmed
*/
app.post("/paystack/webhook", async (req, res) => {
  try {
    const event = req.body;

    if (event.event !== "charge.success") {
      return res.sendStatus(200);
    }

    const data = event.data;
    const { uid, purpose } = data.metadata;
    const amount = data.amount / 100;

    const userRef = db.collection("users").doc(uid);

    if (purpose === "add_money") {
      await userRef.update({
        balance: admin.firestore.FieldValue.increment(amount),
      });
    }

    if (purpose === "upgrade") {
      await userRef.update({
        isSeller: true,
      });
    }

    // Ledger (VERY IMPORTANT)
    await db.collection("transactions").add({
      uid,
      amount,
      purpose,
      reference: data.reference,
      status: "success",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.sendStatus(500);
  }
});

/* -------------------- WITHDRAW -------------------- */
/*
  Real withdrawal logic (bank details required later)
*/
app.post("/withdraw", verifyUser, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const userRef = db.collection("users").doc(req.uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userSnap.data();

    if ((user.balance || 0) < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // HOLD ONLY — actual Paystack transfer comes later
    await userRef.update({
      balance: admin.firestore.FieldValue.increment(-amount),
    });

    await db.collection("withdrawals").add({
      uid: req.uid,
      amount,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, message: "Withdrawal queued" });
  } catch (err) {
    console.error("WITHDRAW ERROR:", err);
    res.status(500).json({ error: "Withdrawal failed" });
  }
});

/* -------------------- HEALTH CHECK -------------------- */

app.get("/", (_, res) => {
  res.send("✅ True Ads backend running");
});

/* -------------------- START SERVER -------------------- */

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
