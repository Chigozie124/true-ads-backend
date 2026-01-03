import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { db, admin } from "./firebase.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Health check
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

// -------------------- SELLER --------------------
app.post("/seller/upgrade", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const data = userDoc.data();
    if (data.isseller) return res.json({ status: "Already a seller", user: data });

    await userRef.update({ isseller: true, status: "Seller" });
    const updatedDoc = await userRef.get();
    res.json({ status: "User upgraded to seller ✅", user: updatedDoc.data() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upgrade user" });
  }
});

// -------------------- ADD MONEY --------------------
app.post("/add-money", async (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: "Missing parameters" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const newBalance = (userDoc.data().balance || 0) + amount;
    await userRef.update({ balance: newBalance });

    const updatedDoc = await userRef.get();
    res.json({ status: `₦${amount.toLocaleString()} added ✅`, user: updatedDoc.data() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add money" });
  }
});

// -------------------- WITHDRAW --------------------
app.post("/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: "Missing parameters" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const currentBalance = userDoc.data().balance || 0;
    if (amount > currentBalance) return res.status(400).json({ error: "Insufficient balance" });

    const newBalance = currentBalance - amount;
    await userRef.update({ balance: newBalance });

    const updatedDoc = await userRef.get();
    res.json({ status: `₦${amount.toLocaleString()} withdrawn ✅`, user: updatedDoc.data() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to withdraw" });
  }
});

// -------------------- START SERVER -----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
