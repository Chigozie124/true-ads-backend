import express from "express";
import verifyToken from "./middleware-auth.js";
import { db, FieldValue } from "./firebase.js";

const router = express.Router();

/* ===============================
   REQUEST WITHDRAWAL
================================= */
router.post("/request", verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const uid = req.user.uid;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid withdrawal amount"
      });
    }

    const userRef = db.collection("ESCROW_USER").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({
        success: false,
        error: "User wallet not found"
      });
    }

    const user = userSnap.data();

    if (!user.balance || user.balance < amount) {
      return res.status(400).json({
        success: false,
        error: "Insufficient balance"
      });
    }

    // 1️⃣ Deduct balance
    await userRef.update({
      balance: FieldValue.increment(-Number(amount))
    });

    // 2️⃣ Create withdrawal request
    await db.collection("ESCROW_WITHDRAWS").add({
      uid,
      amount: Number(amount),
      status: "PENDING",
      createdAt: Date.now()
    });

    return res.json({
      success: true,
      message: "Withdrawal request submitted"
    });

  } catch (err) {
    console.error("Withdraw error:", err);
    return res.status(500).json({
      success: false,
      error: "Withdrawal failed"
    });
  }
});

export default router;
