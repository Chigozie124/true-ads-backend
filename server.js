import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
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

// -------------------- CHAT --------------------
app.post("/chat/send", async (req, res) => {
  const { chatId, senderId, message } = req.body;
  if (!chatId || !senderId || !message)
    return res.status(400).json({ error: "Missing fields" });

  try {
    const chatRef = db.collection("chats").doc(chatId);
    await chatRef.update({
      messages: admin.firestore.FieldValue.arrayUnion({
        senderId,
        message,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      }),
    });
    res.json({ status: "Message sent ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

app.get("/chat/:chatId", async (req, res) => {
  const { chatId } = req.params;
  try {
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) return res.status(404).json({ error: "Chat not found" });
    res.json(chatDoc.data());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chat" });
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
    if (data.isseller) return res.json({ status: "Already a seller ✅" });

    // Upgrade user
    await userRef.update({ isseller: true, status: "Seller" });
    res.json({ status: "User upgraded to seller ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upgrade user" });
  }
});

// -------------------- ADD MONEY --------------------
app.post("/add-money", async (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount || !method)
    return res.status(400).json({ error: "Missing fields" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const currentBalance = userDoc.data().balance || 0;
    const newBalance = currentBalance + amount;

    await userRef.update({ balance: newBalance });
    res.json({ status: "Money added ✅", newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add money" });
  }
});

// -------------------- WITHDRAW --------------------
app.post("/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: "Missing fields" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const currentBalance = userDoc.data().balance || 0;
    if (amount > currentBalance)
      return res.status(400).json({ error: "Insufficient balance" });

    const newBalance = currentBalance - amount;
    await userRef.update({ balance: newBalance });
    res.json({ status: "Withdraw successful ✅", newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to withdraw" });
  }
});

// -------------------- PAYMENTS --------------------
app.post("/payment", async (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount || !method)
    return res.status(400).json({ error: "Missing fields" });

  try {
    const paymentRef = db.collection("payments").doc();
    await paymentRef.set({
      userId,
      amount,
      method,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ status: "Payment recorded ✅", paymentId: paymentRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to record payment" });
  }
});

// -------------------- CLEANUP SELLERS --------------------
app.post("/admin/cleanup-sellers", async (req, res) => {
  try {
    const snapshot = await db.collection("users").get();
    const results = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const updates = {};
      if ("seller" in data) updates.seller = admin.firestore.FieldValue.delete();
      if ("isseller" in data && data.isseller === false) updates.isseller = admin.firestore.FieldValue.delete();
      if (Object.keys(updates).length) {
        await doc.ref.update(updates);
        results.push({ userId: doc.id, removed: Object.keys(updates) });
      }
    }
    res.json({ status: "Cleanup done ✅", details: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed cleanup" });
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
