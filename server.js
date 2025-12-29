// server.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// ===============================
// Config
// ===============================
const PORT = process.env.PORT || 3000;
const PAYSTACK_MODE = process.env.PAYSTACK_MODE || "test";

const PAYSTACK_SECRET_KEY =
  PAYSTACK_MODE === "live"
    ? process.env.PAYSTACK_LIVE_SECRET_KEY
    : process.env.PAYSTACK_TEST_SECRET_KEY;

const DEFAULT_EMAIL = process.env.DEFAULT_EMAIL || "chigozieonueze@gmail.com";
const DEFAULT_AMOUNT = process.env.DEFAULT_AMOUNT || 10000; // NGN in kobo

if (!PAYSTACK_SECRET_KEY) {
  console.error("❌ Paystack secret key missing");
}

// Helper for headers
const paystackHeaders = {
  Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
  "Content-Type": "application/json",
};

// ===============================
// Routes
// ===============================

// Home test route
app.get("/", (req, res) => {
  res.json({ status: true, message: "Server is running", mode: PAYSTACK_MODE });
});

// Initialize payment
app.post("/initialize-payment", async (req, res) => {
  try {
    const { email, amount } = req.body || {};
    const payload = {
      email: email || DEFAULT_EMAIL,
      amount: amount || DEFAULT_AMOUNT, // Paystack expects kobo
    };

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: paystackHeaders,
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.status) {
      res.json({
        status: true,
        message: "Authorization URL created",
        data: data.data,
      });
    } else {
      res.json({ status: false, message: "Failed to initialize payment", error: data });
    }
  } catch (err) {
    console.error(err);
    res.json({ status: false, message: "Server error", error: err.message });
  }
});

// Verify payment
app.get("/verify-payment/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: "GET",
      headers: paystackHeaders,
    });

    const data = await response.json();

    if (data.status) {
      // Here you can add logic to handle seller upgrade, commission, delivery, disputes, etc.
      res.json({ status: true, message: "Payment verified", data: data.data });
    } else {
      res.json({ status: false, message: "Failed to verify payment", error: data });
    }
  } catch (err) {
    console.error(err);
    res.json({ status: false, message: "Server error", error: err.message });
  }
});

// ===============================
// Start server
// ===============================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} | Mode: ${PAYSTACK_MODE}`);
});
