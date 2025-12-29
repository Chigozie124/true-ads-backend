import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, updateDoc } from "firebase/firestore";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const firebaseApp = initializeApp({/* your config */});
const db = getFirestore(firebaseApp);

const PAYSTACK_SECRET = process.env.PAYSTACK_MODE === "test"
  ? process.env.PAYSTACK_TEST_SECRET_KEY
  : process.env.PAYSTACK_LIVE_SECRET_KEY;

// Initialize payment & create order
app.post("/initialize-payment", async (req, res) => {
  try {
    const { email, amount, productId, buyerId, sellerId } = req.body;
    if (!email || !amount || !productId || !buyerId || !sellerId) {
      return res.status(400).json({ status: false, message: "Missing data" });
    }

    // Calculate commission (e.g., 10%)
    const commission = Math.floor(amount * 0.1);
    const orderAmount = amount;

    // Create order in Firestore
    const orderRef = doc(db, "orders", `${Date.now()}-${buyerId}`);
    await setDoc(orderRef, {
      buyerId,
      productId,
      sellerId,
      amount: orderAmount,
      commission,
      status: "pending",
      paymentReference: null,
      deliveryInfo: {}
    });

    // Initialize Paystack payment
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        amount: orderAmount,
        callback_url: `${req.headers.origin}/verify-payment?orderId=${orderRef.id}`
      })
    });

    const data = await response.json();
    if (!data.status) return res.json({ status: false, message: data.message });

    // Save reference to order
    await updateDoc(orderRef, { paymentReference: data.data.reference });

    return res.json({ status: true, data: data.data });
  } catch (err) {
    console.error(err);
    return res.json({ status: false, message: err.message });
  }
});

// Verify payment
app.get("/verify-payment", async (req, res) => {
  try {
    const { reference, orderId } = req.query;
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    const data = await response.json();
    if (!data.status) throw new Error("Payment verification failed");

    // Update order status
    const orderRef = doc(db, "orders", orderId);
    await updateDoc(orderRef, { status: "paid" });

    res.send("Payment verified successfully. You can redirect user to frontend.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Verification failed");
  }
});

// Update delivery status (for seller/admin)
app.post("/update-delivery", async (req, res) => {
  try {
    const { orderId, status, deliveryInfo } = req.body;
    if (!orderId || !status) return res.status(400).send("Missing data");

    const orderRef = doc(db, "orders", orderId);
    await updateDoc(orderRef, { status, deliveryInfo });

    res.json({ status: true });
  } catch (err) {
    console.error(err);
    res.json({ status: false, message: err.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
