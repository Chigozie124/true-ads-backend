import express from "express";
import { db } from "../firebase.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();
const MIN_AMOUNT = 100;

async function getOrCreateWallet(uid, email = "") {
  const walletRef = db.collection("wallets").doc(uid);
  const walletDoc = await walletRef.get();

  if (!walletDoc.exists) {
    const newWallet = {
      uid,
      email,
      balance: 0,
      totalFunded: 0,
      totalWithdrawn: 0,
      pendingWithdrawals: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await walletRef.set(newWallet);
    return newWallet;
  }

  return walletDoc.data();
}

/* ================= GET MY WALLET ================= */
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const wallet = await getOrCreateWallet(req.user.uid, req.user.email || "");

    return res.status(200).json({
      success: true,
      wallet
    });
  } catch (error) {
    console.error("GET /api/wallet/me error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallet"
    });
  }
});

/* ================= REQUEST WITHDRAWAL ================= */
router.post("/withdraw", authenticateToken, async (req, res) => {
  try {
    const {
      amount,
      bankName,
      accountNumber,
      accountName
    } = req.body;

    if (!amount || Number(amount) < MIN_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal amount is ₦${MIN_AMOUNT}`
      });
    }

    if (!bankName || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message: "bankName, accountNumber and accountName are required"
      });
    }

    const wallet = await getOrCreateWallet(req.user.uid, req.user.email || "");

    if (Number(wallet.balance || 0) < Number(amount)) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance"
      });
    }

    const walletRef = db.collection("wallets").doc(req.user.uid);
    const withdrawalRef = db.collection("withdrawals").doc();
    const txRef = db.collection("wallet_transactions").doc();

    const newBalance = Number(wallet.balance || 0) - Number(amount);
    const newPending = Number(wallet.pendingWithdrawals || 0) + Number(amount);

    await walletRef.set({
      balance: newBalance,
      pendingWithdrawals: newPending,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    await withdrawalRef.set({
      uid: req.user.uid,
      email: req.user.email || "",
      amount: Number(amount),
      bankName: String(bankName).trim(),
      accountNumber: String(accountNumber).trim(),
      accountName: String(accountName).trim(),
      provider: "flutterwave",
      status: "PENDING",
      adminApproved: false,
      transferReference: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await txRef.set({
      uid: req.user.uid,
      type: "WITHDRAWAL",
      amount: Number(amount),
      status: "PENDING",
      provider: "flutterwave",
      reference: `WD-${Date.now()}`,
      createdAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: "Withdrawal request submitted successfully",
      balance: newBalance
    });
  } catch (error) {
    console.error("POST /api/wallet/withdraw error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit withdrawal request"
    });
  }
});

/* ================= MY TRANSACTIONS ================= */
router.get("/transactions", authenticateToken, async (req, res) => {
  try {
    const snapshot = await db
      .collection("wallet_transactions")
      .where("uid", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .get();

    const transactions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json({
      success: true,
      count: transactions.length,
      transactions
    });
  } catch (error) {
    console.error("GET /api/wallet/transactions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transactions"
    });
  }
});

/* ================= MY WITHDRAWALS ================= */
router.get("/withdrawals", authenticateToken, async (req, res) => {
  try {
    const snapshot = await db
      .collection("withdrawals")
      .where("uid", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .get();

    const withdrawals = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json({
      success: true,
      count: withdrawals.length,
      withdrawals
    });
  } catch (error) {
    console.error("GET /api/wallet/withdrawals error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch withdrawals"
    });
  }
});

export default router;
