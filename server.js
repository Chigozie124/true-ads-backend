import "dotenv/config";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fetch from "node-fetch";
import crypto from "crypto";

/* ================= APP ================= */
const app = express();
app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

/* ================= FIREBASE ================= */
if (!process.env.FIREBASE_ADMIN_JSON) {
  throw new Error("FIREBASE_ADMIN_JSON env variable is not set");
}

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_ADMIN_JSON)
  ),
});

const db = admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

/* ================= PAYSTACK ================= */
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;

if (!PAYSTACK_SECRET) {
  throw new Error("PAYSTACK_SECRET_KEY is missing");
}

/* ================= HELPERS ================= */
const sendNotification = async (uid, title, message) => {
  await db
    .collection("notifications")
    .doc(uid)
    .collection("items")
    .add({
      title,
      message,
      read: false,
      createdAt: now(),
    });
};

const ensureWallet = async (uid) => {
  const ref = db.collection("wallets").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      available: 0,
      pending: 0,
      totalEarned: 0,
      updatedAt: now(),
    });
  }
};

/* ================= PAYSTACK INIT (FIXED) ================= */
app.post("/payments/init", async (req, res) => {
  const { buyerId, productId } = req.body;

  if (!buyerId || !productId) {
    return res.status(400).json({ error: "buyerId and productId required" });
  }

  try {
    /* ---- PRODUCT ---- */
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) {
      return res.status(404).json({ error: "Product not found" });
    }

    const product = productSnap.data();

    if (typeof product.price !== "number" || product.price <= 0) {
      return res.status(400).json({ error: "Invalid product price" });
    }

    if (!product.sellerId) {
      return res.status(400).json({ error: "Product seller missing" });
    }

    /* ---- USER ---- */
    const userSnap = await db.collection("users").doc(buyerId).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userSnap.data();

    if (user.banned === true) {
      return res.status(403).json({ error: "Account banned" });
    }

    if (!user.email) {
      return res.status(400).json({ error: "User email missing" });
    }

    /* ---- PAYMENT RECORD ---- */
    const reference = `TRUADS_${Date.now()}`;

    await db.collection("payments").doc(reference).set({
      buyerId,
      productId,
      sellerId: product.sellerId,
      amount: product.price,
      status: "pending",
      createdAt: now(),
    });

    /* ---- PAYSTACK INIT ---- */
    const payRes = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: user.email,
          amount: product.price * 100,
          reference,
        }),
      }
    );

    const payData = await payRes.json();

    if (!payRes.ok || !payData.status) {
      console.error("Paystack error:", payData);
      return res.status(500).json({
        error: "Paystack initialization failed",
        details: payData.message || "Unknown error",
      });
    }

    res.json(payData.data);

  } catch (err) {
    console.error("INIT PAYMENT ERROR:", err);
    res.status(500).json({ error: "Payment init failed" });
  }
});

/* ================= PAYSTACK WEBHOOK ================= */
app.post("/paystack/webhook", async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const hash = crypto
    .createHmac("sha512", PAYSTACK_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  if (hash !== signature) {
    return res.sendStatus(400);
  }

  const event = req.body;

  if (event.event === "charge.success") {
    const ref = event.data.reference;
    const paymentRef = db.collection("payments").doc(ref);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists) return res.sendStatus(200);

    const payment = paymentSnap.data();

    await ensureWallet(payment.sellerId);

    await db.runTransaction(async tx => {
      tx.update(paymentRef, { status: "paid" });
      tx.update(db.collection("products").doc(payment.productId), {
        status: "sold"
      });
      tx.update(db.collection("wallets").doc(payment.sellerId), {
        pending: admin.firestore.FieldValue.increment(payment.amount),
      });
      tx.set(db.collection("orders").doc(ref), {
        ...payment,
        status: "paid",
        createdAt: now(),
      });
    });

    await sendNotification(payment.sellerId, "New Order", "You have a new order");
    await sendNotification(payment.buyerId, "Payment Successful", "Your order was placed");
  }

  res.sendStatus(200);
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend running on", PORT));
