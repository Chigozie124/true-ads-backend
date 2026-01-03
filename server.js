import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { db, admin } from "./firebase.js";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// -------------------- HEALTH CHECK --------------------
app.get("/", (req, res) => res.json({ status: "Backend ✅" }));

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

// -------------------- ADD MONEY --------------------
app.post("/add-money", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: "Missing data" });

  try {
    const userRef = db.collection("users").doc(userId);
    const snap = await userRef.get();
    if (!snap.exists()) return res.status(404).json({ error: "User not found" });
    const email = snap.data().email;

    // Initialize Paystack transaction
    const paystackSecret = process.env.PAYSTACK_SECRET;
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        amount: Math.floor(amount * 100), // kobo
        metadata: { userId },
        callback_url: `${process.env.BACKEND_URL}/payment/verify`
      })
    });

    const data = await response.json();
    if (!data.status) throw new Error(data.message);

    res.json({ status: "Payment initiated ✅", authorization_url: data.data.authorization_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- VERIFY PAYMENT --------------------
app.post("/payment/verify", async (req, res) => {
  const { reference } = req.body;
  if (!reference) return res.status(400).json({ error: "Missing reference" });

  try {
    const paystackSecret = process.env.PAYSTACK_SECRET;
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${paystackSecret}` }
    });
    const data = await response.json();
    if (!data.status) throw new Error(data.message);

    const metadata = data.data.metadata;
    const userId = metadata.userId;
    const amount = data.data.amount / 100;

    // Update user balance
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      balance: admin.firestore.FieldValue.increment(amount)
    });

    res.json({ status: "Payment verified ✅", amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- WITHDRAW --------------------
app.post("/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: "Missing data" });

  try {
    const userRef = db.collection("users").doc(userId);
    const snap = await userRef.get();
    if (!snap.exists()) return res.status(404).json({ error: "User not found" });

    const userData = snap.data();
    if (userData.balance < amount) return res.status(400).json({ error: "Insufficient balance" });

    // Simulate withdrawal (Paystack transfer can be added here)
    await userRef.update({
      balance: admin.firestore.FieldValue.increment(-amount)
    });

    res.json({ status: `₦${amount} withdrawal successful ✅` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- UPGRADE TO SELLER --------------------
app.post("/seller/upgrade", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const userRef = db.collection("users").doc(userId);
    const snap = await userRef.get();
    if (!snap.exists()) return res.status(404).json({ error: "User not found" });

    const data = snap.data();
    if (data.isseller) return res.json({ status: "Already a seller ✅" });

    await userRef.update({ isseller: true, status: "Seller" });
    res.json({ status: "User upgraded to seller ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
