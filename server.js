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

// 🔐 Paystack mode & keys
const MODE = process.env.PAYSTACK_MODE || "test";

const PAYSTACK_SECRET_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_SECRET_KEY
    : process.env.PAYSTACK_TEST_SECRET_KEY;

const PAYSTACK_PUBLIC_KEY =
  MODE === "live"
    ? process.env.PAYSTACK_LIVE_PUBLIC_KEY
    : process.env.PAYSTACK_TEST_PUBLIC_KEY;

if (!PAYSTACK_SECRET_KEY) {
  console.error("❌ Paystack secret key missing");
}

// ===============================
// Initialize Payment
// ===============================
app.post("/pay/initiate", async (req, res) => {
  try {
    let { email, amount, purpose } = req.body;

    if (!email) email = process.env.DEFAULT_EMAIL || "test@example.com";
    if (!amount) amount = 5000; // default ₦50.00
    amount = Number(amount) * 100; // convert to kobo

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount,
        metadata: { purpose }, // upgrade | wallet
      }),
    });

    const data = await response.json();

    if (!data.status) return res.status(400).json(data);

    res.json({
      status: true,
      reference: data.data.reference,
      email,
      amount,
      publicKey: PAYSTACK_PUBLIC_KEY,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Payment initialization failed" });
  }
});

app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
