import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch"; // we'll use fetch for Paystack API calls
import { initializeApp } from "firebase/app";
import { getFirestore, doc, updateDoc, getDoc } from "firebase/firestore";

dotenv.config();

// Firebase config (use your Firebase settings)
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID",
};

const app = express();
app.use(cors());
app.use(express.json()); // Important: to parse JSON bodies

// Firestore init
initializeApp(firebaseConfig);
const db = getFirestore();

// Get keys depending on mode
const mode = process.env.PAYSTACK_MODE || "test";
const secretKey =
  mode === "live"
    ? process.env.PAYSTACK_LIVE_SECRET_KEY
    : process.env.PAYSTACK_TEST_SECRET_KEY;

if (!secretKey) {
  console.error("❌ Paystack secret key missing");
}

// Initialize payment endpoint
app.post("/initialize-payment", async (req, res) => {
  try {
    const { email, amount } = req.body || {};
    if (!email || !amount) {
      return res.status(400).json({ status: false, message: "Email and amount required" });
    }

    // Create payment on Paystack
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amount * 100, // Paystack uses kobo
        callback_url: "http://localhost:3000/verify-payment", // redirect after payment
      }),
    });

    const data = await response.json();
    if (data.status) {
      return res.json({
        status: true,
        message: "Authorization URL created",
        data: data.data,
      });
    } else {
      return res.json({ status: false, message: data.message || "Failed to initialize payment" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  }
});

// Verify payment endpoint
app.get("/verify-payment/:reference/:uid", async (req, res) => {
  try {
    const { reference, uid } = req.params;
    if (!reference || !uid) return res.status(400).json({ status: false, message: "Reference & UID required" });

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const data = await response.json();

    if (data.status && data.data.status === "success") {
      // Update Firestore user to seller
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, { seller: true });
      return res.json({ status: true, message: "Payment successful, user upgraded to seller" });
    } else {
      return res.json({ status: false, message: "Payment not successful" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  }
});

// Basic test route
app.get("/", (req, res) => res.send("Backend running"));

app.listen(process.env.PORT || 3000, () =>
  console.log(`Server running on http://localhost:${process.env.PORT || 3000} | Mode: ${mode}`)
);
