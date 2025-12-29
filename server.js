import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;
const COMMISSION_PERCENT = 10; // 👈 YOU EARN 10%

/* =========================
   🔹 INITIATE PAYMENT
========================= */
app.post("/pay/initiate", async (req, res) => {
  try {
    const { email, amount, type, userId } = req.body;

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: amount * 100,
          metadata: { type, userId },
          callback_url: process.env.CALLBACK_URL,
        }),
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Payment init failed" });
  }
});

/* =========================
   🔹 PAYSTACK WEBHOOK
========================= */
app.post("/pay/webhook", (req, res) => {
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    return res.sendStatus(401);
  }

  const event = req.body;

  if (event.event === "charge.success") {
    const { type, userId } = event.data.metadata;
    const amount = event.data.amount / 100;

    if (type === "upgrade") {
      console.log(`User ${userId} upgraded`);
    }

    if (type === "wallet") {
      console.log(`Wallet funded ₦${amount}`);
    }

    if (type === "purchase") {
      const commission = (amount * COMMISSION_PERCENT) / 100;
      const sellerAmount = amount - commission;
      console.log("Commission:", commission);
      console.log("Seller earns:", sellerAmount);
    }
  }

  res.sendStatus(200);
});

/* =========================
   🔹 HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("TrueAds backend running");
});

app.listen(process.env.PORT || 5000, () =>
  console.log("Backend live")
);
