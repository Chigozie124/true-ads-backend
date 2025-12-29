import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🔐 Paystack mode
const MODE = process.env.PAYSTACK_MODE;

// 🔐 Keys selector
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
    const { email, amount, purpose } = req.body;

    const finalEmail = email || process.env.DEFAULT_EMAIL;
    const finalAmount = amount || process.env.DEFAULT_AMOUNT;

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: finalEmail,
          amount: finalAmount, // kobo
          metadata: { purpose }, // upgrade | wallet | purchase
        }),
      }
    );

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json(data);
    }

    res.json({
      status: true,
      reference: data.data.reference,
      email: finalEmail,
      amount: finalAmount,
      publicKey: PAYSTACK_PUBLIC_KEY, // 🔥 backend decides
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Payment init failed" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT} (${MODE})`);
});
