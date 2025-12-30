import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🔐 Select Paystack mode automatically
const MODE = process.env.PAYSTACK_MODE || "test"; // "live" or "test"

const PAYSTACK_SECRET_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_SECRET_KEY
    : process.env.PAYSTACK_TEST_SECRET_KEY;

const PAYSTACK_PUBLIC_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_PUBLIC_KEY
    : process.env.PAYSTACK_TEST_PUBLIC_KEY;

if (!PAYSTACK_SECRET_KEY) {
  console.error("❌ Paystack secret key missing!");
}

// ===============================
// Initialize Payment
// ===============================
app.post("/pay/initiate", async (req, res) => {
  try {
    const { email, amount, purpose } = req.body;

    if (!email || !amount || !purpose) {
      return res.status(400).json({ status: false, message: "Missing parameters" });
    }

    // Initialize transaction
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount, // in kobo
        metadata: { purpose },
      }),
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ status: false, message: data.message || "Paystack error" });
    }

    res.json({
      status: true,
      reference: data.data.reference,
      email,
      amount,
      publicKey: PAYSTACK_PUBLIC_KEY,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error initializing payment" });
  }
});

// ===============================
// Paystack webhook for successful payments
// ===============================
app.post("/pay/webhook", async (req, res) => {
  try {
    const event = req.body;

    if (event.event === "charge.success") {
      const metadata = event.data.metadata;
      const email = event.data.customer.email;
      const amount = event.data.amount; // in kobo
      const purpose = metadata.purpose;

      // Here you can update Firestore user balance using Firebase Admin SDK
      // e.g., increase user's balance if purpose === "wallet"
      // or mark user as seller if purpose === "upgrade"
      console.log(`Payment success for ${email}, purpose: ${purpose}, amount: ${amount}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT} (${MODE} mode)`);
});
