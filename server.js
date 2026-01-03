// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { db, admin } from "./firebase.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// -------------------- HEALTH CHECK --------------------
app.get("/", (req, res) => {
  res.json({ status: "Backend running ✅" });
});

// -------------------- USERS --------------------
// Get all users (for demo)
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

// Get single user by UID
app.post("/user", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  try {
    const docRef = db.collection("users").doc(userId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return res.status(404).json({ error: "User not found" });
    res.json({ id: docSnap.id, ...docSnap.data() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// -------------------- UPGRADE TO SELLER --------------------
app.post("/seller/upgrade", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const data = userDoc.data();
    if (data.isseller) return res.json({ status: "Already a seller" });

    await userRef.update({ isseller: true, status: "Seller" });
    res.json({ status: "User upgraded to seller ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upgrade user" });
  }
});

// -------------------- ADD MONEY --------------------
app.post("/add-money", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || typeof amount !== "number") return res.status(400).json({ error: "Missing or invalid fields" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const newBalance = (userDoc.data().balance || 0) + amount;
    await userRef.update({ balance: newBalance });

    res.json({ status: "Money added ✅", balance: newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add money" });
  }
});

// -------------------- WITHDRAW --------------------
app.post("/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || typeof amount !== "number") return res.status(400).json({ error: "Missing or invalid fields" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const currentBalance = userDoc.data().balance || 0;
    if (amount > currentBalance) return res.status(400).json({ error: "Insufficient balance" });

    const newBalance = currentBalance - amount;
    await userRef.update({ balance: newBalance });

    res.json({ status: "Withdrawal successful ✅", balance: newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to withdraw" });
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
