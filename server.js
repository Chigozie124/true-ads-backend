import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { db, admin } from "./firebase.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// -------------------- HEALTH CHECK --------------------
app.get("/", (req, res) => res.json({ status: "Backend running ✅" }));

// -------------------- USERS --------------------
app.get("/users", async (req, res) => {
  try {
    const snapshot = await db.collection("users").get();
    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// -------------------- SELLER UPGRADE --------------------
app.post("/seller/upgrade", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const data = userDoc.data();
    if (data.isseller) return res.json({ status: "Already a seller ✅" });

    await userRef.update({ isseller: true, status: "Seller" });
    res.json({ status: "User upgraded to seller ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upgrade user" });
  }
});

// -------------------- PAYMENTS --------------------
// Record payment request
app.post("/add-money", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: "Missing data" });

  try {
    const userRef = db.collection("users").doc(userId);
    const snap = await userRef.get();
    if (!snap.exists()) return res.status(404).json({ error: "User not found" });

    // Here you would initialize Paystack payment and return authorization URL
    // For now we just simulate pending payment
    const paymentRef = db.collection("payments").doc();
    await paymentRef.set({
      userId,
      amount,
      method: "Paystack",
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ status: "Add money request recorded ✅", paymentId: paymentRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add money" });
  }
});

// Withdraw money
app.post("/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: "Missing data" });

  try {
    const userRef = db.collection("users").doc(userId);
    const snap = await userRef.get();
    if (!snap.exists()) return res.status(404).json({ error: "User not found" });

    const balance = snap.data().balance || 0;
    if (balance < amount) return res.status(400).json({ error: "Insufficient balance" });

    await userRef.update({ balance: balance - amount });
    res.json({ status: `Withdrawal of ₦${amount} successful ✅`, newBalance: balance - amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to withdraw" });
  }
});

// -------------------- PAYSTACK CALLBACK --------------------
app.get("/payment/verify/:reference", async (req, res) => {
  const { reference } = req.params;
  try {
    const paystackSecret = process.env.PAYSTACK_SECRET;
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` }
    });
    const data = await response.json();

    if (data.status && data.data.status === "success") {
      const userId = data.data.metadata.userId;
      const amount = data.data.amount / 100;
      const userRef = db.collection("users").doc(userId);

      const snap = await userRef.get();
      if (snap.exists()) {
        const currentBalance = snap.data().balance || 0;
        await userRef.update({ balance: currentBalance + amount });
      }

      res.json({ status: "Payment successful ✅", amount });
    } else {
      res.status(400).json({ error: "Payment not successful" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
