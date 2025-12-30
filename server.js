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

// 🔐 Keys selector
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
// Initiate Payment
// ===============================
app.post("/pay/initiate", async (req, res) => {
  try {
    const { email, amount, purpose } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ status: false, message: "Email and amount required" });
    }

    const amountInKobo = amount * 100; // convert to kobo
    console.log(`💰 Initializing ${purpose} payment for ${email}: ₦${amount} (${amountInKobo} kobo)`);

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountInKobo,
        metadata: { purpose },
      }),
    });

    const data = await response.json();
    console.log("📦 Paystack response:", data);

    if (!data.status) {
      return res.status(400).json({ status: false, message: data.message || "Paystack init failed" });
    }

    res.json({
      status: true,
      reference: data.data.reference,
      email,
      amount: amountInKobo,
      publicKey: PAYSTACK_PUBLIC_KEY,
    });

  } catch (err) {
    console.error("❌ Payment initiation error:", err);
    res.status(500).json({ status: false, message: "Server error initializing payment" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT} (Mode: ${MODE})`);
});
