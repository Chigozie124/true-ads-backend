import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch"; // for Paystack API
import { db, admin } from "./firebase.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Health check
app.get("/", (req, res) => res.json({ status: "Backend is running ✅" }));

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
  const { userId, paystackReference } = req.body;
  if (!userId || !paystackReference) return res.status(400).json({ error: "User ID or payment reference missing" });

  try {
    // Verify payment with Paystack
    const verify = await fetch(`https://api.paystack.co/transaction/verify/${paystackReference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET}` }
    });
    const result = await verify.json();
    if (!result.status) return res.status(400).json({ error: "Payment verification failed" });

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    if (userDoc.data().isseller) return res.json({ status: "User already a seller ✅" });

    await userRef.update({ isseller: true, status: "Seller" });
    res.json({ status: "User upgraded to seller ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upgrade user" });
  }
});

// -------------------- ADD MONEY --------------------
app.post("/add-money", async (req, res) => {
  const { userId, amount, paystackReference } = req.body;
  if (!userId || !amount || !paystackReference) return res.status(400).json({ error: "Missing parameters" });

  try {
    // Verify payment with Paystack
    const verify = await fetch(`https://api.paystack.co/transaction/verify/${paystackReference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET}` }
    });
    const result = await verify.json();
    if (!result.status) return res.status(400).json({ error: "Payment verification failed" });

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const currentBalance = userDoc.data().balance || 0;
    await userRef.update({ balance: currentBalance + Number(amount) });

    res.json({ status: "Balance updated ✅", newBalance: currentBalance + Number(amount) });
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

    const userData = userDoc.data();
    if (!userData.kycVerified) return res.status(403).json({ error: "KYC verification required" });

    if ((userData.balance || 0) < amount) return res.status(400).json({ error: "Insufficient balance" });

    await userRef.update({ balance: (userData.balance || 0) - Number(amount) });
    res.json({ status: "Withdrawal successful ✅", newBalance: (userData.balance || 0) - Number(amount) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to withdraw" });
  }
});

// -------------------- REFUNDS / DISPUTES --------------------
app.post("/refund", async (req, res) => {
  const { userId, paymentId, reason } = req.body;
  if (!userId || !paymentId || !reason) return res.status(400).json({ error: "Missing parameters" });

  try {
    const refundRef = db.collection("refunds").doc();
    await refundRef.set({
      userId,
      paymentId,
      reason,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ status: "Refund request submitted ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit refund" });
  }
});

// -------------------- KYC VERIFICATION --------------------
app.post("/kyc/verify", async (req, res) => {
  const { userId, documentUrl } = req.body;
  if (!userId || !documentUrl) return res.status(400).json({ error: "Missing parameters" });

  try {
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      kycVerified: false,
      kycDocument: documentUrl,
      kycStatus: "pending"
    });
    res.json({ status: "KYC document submitted ✅, pending approval" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit KYC" });
  }
});

// -------------------- ADMIN CLEANUP --------------------
app.post("/admin/cleanup-sellers", async (req, res) => {
  try {
    const snapshot = await db.collection("users").get();
    const results = [];
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const updates = {};
      if ("seller" in data) updates.seller = admin.firestore.FieldValue.delete();
      if ("isseller" in data && data.isseller === false) updates.isseller = admin.firestore.FieldValue.delete();
      if (Object.keys(updates).length) {
        await docSnap.ref.update(updates);
        results.push({ userId: docSnap.id, removedFields: updates });
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
