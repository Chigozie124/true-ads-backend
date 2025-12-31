// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🔐 Paystack mode selector
const MODE = process.env.PAYSTACK_MODE || "test";

const PAYSTACK_SECRET_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_SECRET_KEY
    : process.env.PAYSTACK_TEST_SECRET_KEY;

const PAYSTACK_PUBLIC_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_PUBLIC_KEY
    : process.env.PAYSTACK_TEST_PUBLIC_KEY;

if (!PAYSTACK_SECRET_KEY) console.error("❌ Paystack secret key missing");

// ===============================
// 🔹 Initialize payment
// ===============================
app.post("/pay/initiate", async (req, res) => {
  try {
    const { email, amount, purpose } = req.body;
    if (!amount || !purpose) return res.status(400).json({ status: false, message: "Amount & purpose required" });

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount,
        metadata: { purpose },
      }),
    });

    const data = await response.json();
    if (!data.status) return res.status(400).json(data);

    res.json({
      status: true,
      reference: data.data.reference,
      amount: data.data.amount,
      email,
      publicKey: PAYSTACK_PUBLIC_KEY,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Payment initiation failed" });
  }
});

// ===============================
// 🔹 Webhook to confirm payment
// ===============================
app.post("/pay/webhook", async (req, res) => {
  const event = req.body;
  // TODO: Verify Paystack signature header for security

  if (event.event === "charge.success") {
    const { metadata, amount, customer } = event.data;
    const purpose = metadata?.purpose;
    const email = customer.email;

    // Update Firestore balances based on purpose
    // Add money, upgrade, purchase, etc.
    // TODO: Implement Firestore integration here
    console.log("Payment verified:", purpose, email, amount);
  }

  res.sendStatus(200);
});

// ===============================
// 🔹 Withdraw endpoint
// ===============================
app.post("/pay/withdraw", async (req, res) => {
  try {
    const { account_number, bank_code, amount, reason } = req.body;
    if (!account_number || !bank_code || !amount) return res.status(400).json({ status: false, message: "Missing info" });

    const response = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        reason: reason || "Withdrawal",
        amount,
        recipient: account_number, // Paystack recipient code
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Withdrawal failed" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
