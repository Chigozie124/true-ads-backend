import express from "express";
import axios from "axios";
import { db } from "../firebase.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();
const MIN_AMOUNT = 100;

function getPaystackSecretKey() {
  const mode = (process.env.PAYSTACK_MODE || "test").toLowerCase();

  if (mode === "live") {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      throw new Error("PAYSTACK_SECRET_KEY is missing");
    }
    return process.env.PAYSTACK_SECRET_KEY;
  }

  if (!process.env.PAYSTACK_SECRET_TEST_KEY) {
    throw new Error("PAYSTACK_SECRET_TEST_KEY is missing");
  }

  return process.env.PAYSTACK_SECRET_TEST_KEY;
}

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

/* ================= INIT DEPOSIT ================= */
router.post("/deposit/init", authenticateToken, async (req, res) => {
  try {
    const { amount, email } = req.body;

    if (!amount || Number(amount) < MIN_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: `Minimum deposit amount is ₦${MIN_AMOUNT}`
      });
    }

    const paystackSecret = getPaystackSecretKey();
    const reference = `TA-${req.user.uid}-${Date.now()}`;
    const userEmail = email || req.user.email;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: "User email is required for payment"
      });
    }

    const callbackUrl = `${process.env.BASE_URL}/api/payments/deposit/verify/${reference}`;

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: userEmail,
        amount: Math.round(Number(amount) * 100),
        reference,
        callback_url: callbackUrl,
        metadata: {
          uid: req.user.uid,
          source: "true_ads_wallet_funding"
        }
      },
      {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          "Content-Type": "application/json"
        }
      }
    );

    await db.collection("payment_attempts").doc(reference).set({
      uid: req.user.uid,
      email: userEmail,
      amount: Number(amount),
      provider: "paystack",
      mode: (process.env.PAYSTACK_MODE || "test").toLowerCase(),
      reference,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: "Deposit initialized successfully",
      reference,
      authorizationUrl: response.data.data.authorization_url,
      accessCode: response.data.data.access_code
    });
  } catch (error) {
    console.error("POST /api/payments/deposit/init error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Failed to initialize deposit"
    });
  }
});

/* ================= VERIFY DEPOSIT ================= */
router.get("/deposit/verify/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    const paystackSecret = getPaystackSecretKey();

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${paystackSecret}`
        }
      }
    );

    const paymentData = response.data.data;

    if (!paymentData || paymentData.status !== "success") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful"
      });
    }

    const paymentRef = db.collection("payment_attempts").doc(reference);
    const paymentDoc = await paymentRef.get();

    if (!paymentDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Payment reference not found"
      });
    }

    const existingPayment = paymentDoc.data();

    if (existingPayment.status === "SUCCESS") {
      return res.status(200).json({
        success: true,
        message: "Payment already verified",
        reference
      });
    }

    const uid = existingPayment.uid;
    const amount = Number(existingPayment.amount);

    const wallet = await getOrCreateWallet(uid, existingPayment.email || "");
    const walletRef = db.collection("wallets").doc(uid);
    const txRef = db.collection("wallet_transactions").doc();

    const newBalance = Number(wallet.balance || 0) + amount;

    await walletRef.set({
      uid,
      email: existingPayment.email || "",
      balance: newBalance,
      totalFunded: Number(wallet.totalFunded || 0) + amount,
      totalWithdrawn: Number(wallet.totalWithdrawn || 0),
      pendingWithdrawals: Number(wallet.pendingWithdrawals || 0),
      updatedAt: new Date().toISOString()
    }, { merge: true });

    await paymentRef.set({
      status: "SUCCESS",
      gatewayResponse: paymentData.gateway_response || "",
      paidAt: paymentData.paid_at || new Date().toISOString(),
      channel: paymentData.channel || "",
      updatedAt: new Date().toISOString()
    }, { merge: true });

    await txRef.set({
      uid,
      type: "DEPOSIT",
      amount,
      status: "SUCCESS",
      provider: "paystack",
      reference,
      createdAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: "Payment verified and wallet funded successfully",
      reference,
      balance: newBalance
    });
  } catch (error) {
    console.error("GET /api/payments/deposit/verify/:reference error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Failed to verify payment"
    });
  }
});

/* ================= PAYMENT STATUS ================= */
router.get("/status/:reference", authenticateToken, async (req, res) => {
  try {
    const doc = await db.collection("payment_attempts").doc(req.params.reference).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found"
      });
    }

    const payment = doc.data();

    if (payment.uid !== req.user.uid && req.user.uid !== process.env.ADMIN_UID) {
      return res.status(403).json({
        success: false,
        message: "Not allowed to view this payment"
      });
    }

    return res.status(200).json({
      success: true,
      payment: {
        reference: doc.id,
        ...payment
      }
    });
  } catch (error) {
    console.error("GET /api/payments/status/:reference error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment status"
    });
  }
});

export default router;
