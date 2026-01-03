import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { db, admin } from "./firebase.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ---------- HEALTH CHECK ----------
app.get("/", (req, res) => res.json({ status: "Backend online ✅" }));

// ---------- USERS ----------
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

// ---------- CHAT ----------
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
      })
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

// ---------- SELLER ----------
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

// ---------- PAYMENTS ----------
app.post("/payment/add-money", async (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount || !method) return res.status(400).json({ error: "Missing fields" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const data = userDoc.data();
    const newBalance = (data.balance || 0) + parseFloat(amount);

    // Add transaction to payments collection
    await db.collection("payments").add({
      userId,
      amount: parseFloat(amount),
      method,
      status: "success",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update user balance
    await userRef.update({ balance: newBalance });

    res.json({ status: "Money added ✅", balance: newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add money" });
  }
});

app.post("/payment/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: "Missing fields" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const data = userDoc.data();

    if (!data.kycVerified)
      return res.status(403).json({ error: "KYC not verified. Cannot withdraw." });

    if ((data.balance || 0) < parseFloat(amount))
      return res.status(400).json({ error: "Insufficient balance" });

    const newBalance = data.balance - parseFloat(amount);

    // Record withdrawal
    await db.collection("payments").add({
      userId,
      amount: parseFloat(amount),
      method: "withdraw",
      status: "success",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update balance
    await userRef.update({ balance: newBalance });

    res.json({ status: "Withdraw successful ✅", balance: newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to withdraw" });
  }
});

// ---------- REFUND & DISPUTE ----------
app.post("/payment/refund", async (req, res) => {
  const { paymentId, reason } = req.body;
  if (!paymentId || !reason) return res.status(400).json({ error: "Missing fields" });

  try {
    const paymentRef = db.collection("payments").doc(paymentId);
    const paymentDoc = await paymentRef.get();
    if (!paymentDoc.exists) return res.status(404).json({ error: "Payment not found" });

    await paymentRef.update({
      status: "refund_requested",
      refundReason: reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ status: "Refund requested ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to request refund" });
  }
});

// ---------- KYC VERIFICATION ----------
app.post("/user/verify-kyc", async (req, res) => {
  const { userId, kycPassed } = req.body;
  if (!userId || typeof kycPassed !== "boolean") return res.status(400).json({ error: "Missing fields" });

  try {
    const userRef = db.collection("users").doc(userId);
    await userRef.update({ kycVerified: kycPassed });
    res.json({ status: `KYC ${kycPassed ? "approved ✅" : "rejected ❌"}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update KYC status" });
  }
});

// ---------- CLEANUP SELLERS ----------
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
        results.push({ userId: doc.id, removed: updates });
      }
    }

    res.json({ status: "Cleanup done ✅", details: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed cleanup" });
  }
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
