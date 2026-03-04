import verifyToken from "../middleware/auth.js";
import { db, FieldValue } from "../firebase.js";
import express from "express";

const router = express.Router();

// ESCROW_USER and ESCROW_WITHDRAWS collections
const ESCROW_USER = "escrowUsers";
const ESCROW_WITHDRAWS = "escrowWithdraws";

// Request withdrawal (seller)
router.post("/request", verifyToken, async (req, res) => {
  try {
    const { amount, bankDetails } = req.body;
    const userId = req.user.userId;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Check available balance (funds not in escrow)
    const userRef = db.collection(ESCROW_USER).doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "Seller not found" });
    }

    const userData = userDoc.data();
    const availableBalance = userData.availableBalance || 0;

    if (amount > availableBalance) {
      return res.status(400).json({ 
        error: "Insufficient available balance",
        available: availableBalance,
        requested: amount
      });
    }

    // Create withdrawal request
    const withdrawRef = db.collection(ESCROW_WITHDRAWS).doc();
    const withdrawData = {
      id: withdrawRef.id,
      userId,
      amount,
      bankDetails,
      status: "pending", // pending, approved, rejected, paid
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    await withdrawRef.set(withdrawData);

    // Deduct from available balance immediately (or hold it)
    await userRef.update({
      availableBalance: FieldValue.increment(-amount),
      pendingWithdrawal: FieldValue.increment(amount)
    });

    res.json({
      success: true,
      message: "Withdrawal request submitted",
      withdrawalId: withdrawRef.id,
      status: "pending"
    });

  } catch (error) {
    console.error("Withdrawal request error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get withdrawal history
router.get("/history", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const snapshot = await db
      .collection(ESCROW_WITHDRAWS)
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    const withdrawals = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({ withdrawals });

  } catch (error) {
    console.error("Get withdrawal history error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get all pending withdrawals
router.get("/admin/pending", verifyToken, async (req, res) => {
  try {
    // Check if admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const snapshot = await db
      .collection(ESCROW_WITHDRAWS)
      .where("status", "==", "pending")
      .orderBy("createdAt", "desc")
      .get();

    const withdrawals = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data();
        // Get user details
        const userDoc = await db.collection("users").doc(data.userId).get();
        return {
          id: doc.id,
          ...data,
          user: userDoc.exists ? userDoc.data() : null
        };
      })
    );

    res.json({ withdrawals });

  } catch (error) {
    console.error("Get pending withdrawals error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Process withdrawal (approve/reject/paid)
router.post("/admin/process/:withdrawalId", verifyToken, async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { status, notes } = req.body; // status: approved, rejected, paid

    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const withdrawRef = db.collection(ESCROW_WITHDRAWS).doc(withdrawalId);
    const withdrawDoc = await withdrawRef.get();

    if (!withdrawDoc.exists) {
      return res.status(404).json({ error: "Withdrawal not found" });
    }

    const withdrawData = withdrawDoc.data();

    if (withdrawData.status === status) {
      return res.status(400).json({ error: `Already ${status}` });
    }

    const updateData = {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      processedBy: req.user.userId,
      notes: notes || ""
    };

    // If rejected, return funds to available balance
    if (status === "rejected") {
      const userRef = db.collection(ESCROW_USER).doc(withdrawData.userId);
      await userRef.update({
        availableBalance: FieldValue.increment(withdrawData.amount),
        pendingWithdrawal: FieldValue.increment(-withdrawData.amount)
      });
    }

    // If paid, just update status (funds already deducted)
    if (status === "paid") {
      const userRef = db.collection(ESCROW_USER).doc(withdrawData.userId);
      await userRef.update({
        pendingWithdrawal: FieldValue.increment(-withdrawData.amount),
        totalWithdrawn: FieldValue.increment(withdrawData.amount)
      });
    }

    await withdrawRef.update(updateData);

    res.json({
      success: true,
      message: `Withdrawal ${status}`,
      withdrawalId
    });

  } catch (error) {
    console.error("Process withdrawal error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get seller stats
router.get("/stats", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const userDoc = await db.collection(ESCROW_USER).doc(userId).get();
    
    if (!userDoc.exists) {
      return res.json({
        availableBalance: 0,
        pendingWithdrawal: 0,
        totalEarned: 0,
        totalWithdrawn: 0
      });
    }

    const data = userDoc.data();
    res.json({
      availableBalance: data.availableBalance || 0,
      pendingWithdrawal: data.pendingWithdrawal || 0,
      totalEarned: data.totalEarned || 0,
      totalWithdrawn: data.totalWithdrawn || 0
    });

  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
