// ===============================
// Server.js - True Ads Backend
// ===============================

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🔹 Paystack keys & mode
const PAYSTACK_MODE = process.env.PAYSTACK_MODE || "test";
const PAYSTACK_SECRET_KEY =
  PAYSTACK_MODE === "live"
    ? process.env.PAYSTACK_LIVE_SECRET_KEY
    : process.env.PAYSTACK_TEST_SECRET_KEY;

if (!PAYSTACK_SECRET_KEY) {
  console.error("❌ Paystack secret key missing");
}

// Default payment info
const DEFAULT_EMAIL = process.env.DEFAULT_EMAIL || "chigozieonueze@gmail.com";
const DEFAULT_AMOUNT = Number(process.env.DEFAULT_AMOUNT) || 10000;

// Helper to initialize payment
const initializePayment = async (email, amount) => {
  try {
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount,
        callback_url: "http://localhost:3000/verify-payment", // change later if needed
      }),
    });

    const data = await res.json();
    return data;
  } catch (err) {
    console.error(err);
    return { status: false, message: "Failed to initialize payment" };
  }
};

// Endpoint: initialize payment
app.post("/initialize-payment", async (req, res) => {
  const { email, amount } = req.body || {};
  const userEmail = email || DEFAULT_EMAIL;
  const payAmount = amount || DEFAULT_AMOUNT;

  const result = await initializePayment(userEmail, payAmount);
  res.json(result);
});

// Endpoint: verify payment
app.get("/verify-payment/:reference", async (req, res) => {
  const { reference } = req.params;
  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await response.json();
    if (data.status) {
      // You can update user status or mark order as paid here
      res.json({ status: true, message: "Payment verified", data: data.data });
    } else {
      res.json({ status: false, message: "Payment not verified" });
    }
  } catch (err) {
    console.error(err);
    res.json({ status: false, message: "Failed to verify payment" });
  }
});

app.get("/", (req, res) => {
  res.send(`Server running on http://localhost:${PORT} | Mode: ${PAYSTACK_MODE}`);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} | Mode: ${PAYSTACK_MODE}`);
});
