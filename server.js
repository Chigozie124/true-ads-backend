import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { db, admin } from "./firebase.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Paystack keys from environment
const PAYSTACK_SECRET_LIVE = process.env.PAYSTACK_SECRET_LIVE;
const PAYSTACK_SECRET_TEST = process.env.PAYSTACK_SECRET_TEST;
const PAYSTACK_ENV = process.env.PAYSTACK_ENV || "test"; // "live" or "test"
const PAYSTACK_SECRET =
  PAYSTACK_ENV === "live" ? PAYSTACK_SECRET_LIVE : PAYSTACK_SECRET_TEST;

// Health check
app.get("/", (req, res) => res.json({ status: "Backend up ✅" }));

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
    return res.status(400).json({ error: "Missing parameters" });

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

// -------------------- SELLER --------------------
app.post("/seller/upgrade", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const data = userDoc.data();
    if (data.isseller)
      return res.json({ status: "Already a seller ✅" });

    await userRef.update({ isseller: true, status: "Seller" });
    res.json({ status: "User upgraded to seller ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upgrade user" });
  }
});

// -------------------- PAYMENTS --------------------

// Add Money (Payment initiation)
app.post("/payment/add-money", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount)
    return res.status(400).json({ error: "Missing parameters" });

  try {
    // Create pending payment record
    const paymentRef = db.collection("payments").doc();
    await paymentRef.set({
      userId,
      amount,
      method: "add-money",
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      status: "Payment recorded ✅",
      paymentId: paymentRef.id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create payment" });
  }
});

// Withdraw (Queued processing)
app.post("/payment/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount)
    return res.status(400).json({ error: "Missing parameters" });

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const userData = userDoc.data();
    if (!userData.isKycVerified)
      return res.status(403).json({ error: "KYC verification required" });

    if (userData.balance < amount)
      return res.status(400).json({ error: "Insufficient balance" });

    // Create a queued withdrawal
    const withdrawRef = db.collection("withdrawals").doc();
    await withdrawRef.set({
      userId,
      amount,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ status: "Withdrawal queued ✅", withdrawId: withdrawRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to queue withdrawal" });
  }
});

// -------------------- PAYSTACK WEBHOOK --------------------
app.post("/paystack/webhook", async (req, res) => {
  try {
    const event = req.body;

    // Only process successful payments
    if (event.event === "charge.success") {
      const paymentRef = db.collection("payments").doc(event.data.reference);
      const paymentDoc = await paymentRef.get();
      if (paymentDoc.exists && paymentDoc.data().status === "pending") {
        const { userId, amount } = paymentDoc.data();
        const userRef = db.collection("users").doc(userId);
        await userRef.update({
          balance: admin.firestore.FieldValue.increment(amount)
        });
        await paymentRef.update({ status: "completed" });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// -------------------- BACKGROUND QUEUE PROCESS --------------------
async function processWithdrawals() {
  const pending = await db.collection("withdrawals")
    .where("status", "==", "pending")
    .get();

  for (const doc of pending.docs) {
    const w = doc.data();
    const userRef = db.collection("users").doc(w.userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    if (!userData || userData.balance < w.amount) {
      await doc.ref.update({ status: "failed", reason: "Insufficient balance" });
      continue;
    }

    // Attempt Paystack transfer
    try {
      const response = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          source: "balance",
          reason: "User withdrawal",
          amount: w.amount * 100, // kobo
          recipient: userData.paystackRecipientCode // must be set during KYC
        })
      });

      const result = await response.json();

      if (result.status) {
        await userRef.update({ balance: userData.balance - w.amount });
        await doc.ref.update({ status: "completed", transferRef: result.data.reference });
      } else {
        await doc.ref.update({ status: "failed", reason: result.message });
      }
    } catch (err) {
      console.error("Withdrawal error:", err);
      await doc.ref.update({ status: "failed", reason: "Transfer error" });
    }
  }
}

// Run every 20 seconds
setInterval(processWithdrawals, 20000);

// -------------------- ADMIN CLEANUP --------------------
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

// -------------------- START SERVER -----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
