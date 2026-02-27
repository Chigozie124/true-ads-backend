import express from "express";
import { db, FieldValue } from "./firebase.js";
import verifyToken from "./middleware-auth.js";
import ensureUserData from "./ensureUserData.js";

const router = express.Router();

/* ===============================
   GET WALLET BALANCE
================================= */
router.get("/", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    // Ensure wallet exists
    await ensureUserData(uid);

    const doc = await db.collection("ESCROW_USER").doc(uid).get();

    if (!doc.exists) {
      return res.json({
        success: true,
        balance: 0
      });
    }

    const wallet = doc.data();

    return res.json({
      success: true,
      balance: wallet.balance || 0
    });

  } catch (err) {
    console.error("Wallet error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch wallet"
    });
  }
});

/* ===============================
   ADD FUNDS (Manual / Testing)
================================= */
router.post("/add", verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const uid = req.user.uid;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount"
      });
    }

    const walletRef = db.collection("ESCROW_USER").doc(uid);

    await walletRef.update({
      balance: FieldValue.increment(Number(amount))
    });

    return res.json({
      success: true,
      message: "Funds added successfully"
    });

  } catch (err) {
    console.error("Add funds error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to add funds"
    });
  }
});

export default router;
