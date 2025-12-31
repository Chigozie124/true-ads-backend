import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase-admin/firestore";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Paystack mode & keys
const MODE = process.env.PAYSTACK_MODE || "test";
const PAYSTACK_SECRET_KEY =
  MODE === "live" ? process.env.PAYSTACK_LIVE_SECRET_KEY : process.env.PAYSTACK_TEST_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY =
  MODE === "live" ? process.env.PAYSTACK_LIVE_PUBLIC_KEY : process.env.PAYSTACK_TEST_PUBLIC_KEY;

// Firebase Admin
import adminCred from "./firebase-admin.json" assert { type: "json" };
initializeApp({ credential: cert(adminCred) });
const db = getFirestore();

// ===============================
// Initiate payment (upgrade/add money)
// ===============================
app.post("/pay/initiate", async (req, res) => {
  try {
    const { email, amount, purpose } = req.body;
    if (!email || !amount) return res.status(400).json({ status: false, message: "Missing data" });

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, amount, metadata: { purpose } }),
    });

    const data = await response.json();
    if (!data.status) return res.status(400).json(data);

    res.json({ status: true, reference: data.data.reference, email, amount, publicKey: PAYSTACK_PUBLIC_KEY });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Payment initiation failed" });
  }
});

// ===============================
// Purchase product
// ===============================
app.post("/pay/purchase", async (req, res) => {
  try {
    const { buyerUid, productId } = req.body;
    if (!buyerUid || !productId) return res.status(400).json({ status: false, message: "Missing buyer or product" });

    const productSnap = await getDoc(doc(db, "products", productId));
    if (!productSnap.exists()) return res.status(404).json({ status: false, message: "Product not found" });

    const product = productSnap.data();
    const sellerUid = product.sellerUid;
    const price = product.price;

    // Commission 10%
    const commission = Math.floor(price * 0.1);
    const sellerAmount = price - commission;

    // Buyer balance check
    const buyerSnap = await getDoc(doc(db, "users", buyerUid));
    const buyerBalance = buyerSnap.data().balance || 0;
    if (buyerBalance < price) return res.status(400).json({ status: false, message: "Insufficient balance" });
    await setDoc(doc(db, "users", buyerUid), { balance: buyerBalance - price }, { merge: true });

    // Update seller balance
    const sellerSnap = await getDoc(doc(db, "users", sellerUid));
    const sellerBalance = sellerSnap.exists() ? sellerSnap.data().balance || 0 : 0;
    await setDoc(doc(db, "users", sellerUid), { balance: sellerBalance + sellerAmount }, { merge: true });

    // Record transaction
    await setDoc(doc(db, "transactions", `${buyerUid}_${productId}_${Date.now()}`), {
      buyerUid, sellerUid, productId, amount: price, commission, sellerAmount, createdAt: new Date(), status: "paid"
    });

    res.json({ status: true, message: "Purchase successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Purchase failed" });
  }
});

// ===============================
// Withdraw
// ===============================
app.post("/pay/withdraw", async (req, res) => {
  try {
    const { sellerUid, amount } = req.body;
    const userSnap = await getDoc(doc(db, "users", sellerUid));
    const balance = userSnap.data().balance || 0;
    if (balance < amount) return res.status(400).json({ status: false, message: "Insufficient balance" });

    await setDoc(doc(db, "users", sellerUid), { balance: balance - amount }, { merge: true });
    res.json({ status: true, message: `₦${amount} withdrawn successfully` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Withdrawal failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
