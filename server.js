import "dotenv/config";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

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

/* ======================================================
   PRODUCTS
====================================================== */
app.post("/products/create", async (req, res) => {
  const { sellerId, title, price, imageUrl } = req.body;

  await db.collection("products").add({
    sellerId,
    title,
    price,
    imageUrl: imageUrl || null,
    status: "active",
    createdAt: now(),
  });

  res.json({ success: true });
});

app.get("/products", async (_, res) => {
  const snap = await db.collection("products").where("status", "==", "active").get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

/* ======================================================
   PAYMENTS (ESCROW)
====================================================== */
app.post("/payment", async (req, res) => {
  const { buyerId, productId } = req.body;
  const productSnap = await db.collection("products").doc(productId).get();

  if (!productSnap.exists) {
    return res.status(404).json({ error: "Product not found" });
  }

  const product = productSnap.data();

  const orderRef = await db.collection("orders").add({
    buyerId,
    sellerId: product.sellerId,
    productId,
    amount: product.price,
    status: "paid",
    createdAt: now(),
  });

  res.json({ success: true, orderId: orderRef.id });
});

/* ======================================================
   DELIVERY CONFIRMATION
====================================================== */
app.post("/order/confirm-delivery", async (req, res) => {
  const { orderId } = req.body;
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();

  if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

  const order = orderSnap.data();
  const walletRef = db.collection("wallets").doc(order.sellerId);

  await db.runTransaction(async tx => {
    tx.update(walletRef, {
      pending: admin.firestore.FieldValue.increment(-order.amount),
      available: admin.firestore.FieldValue.increment(order.amount),
      totalEarned: admin.firestore.FieldValue.increment(order.amount),
      updatedAt: now(),
    });

    tx.update(orderRef, { status: "completed" });
  });

  res.json({ success: true });
});

/* ======================================================
   DISPUTES
====================================================== */
app.post("/dispute/open", async (req, res) => {
  const { orderId, reason } = req.body;
  const orderSnap = await db.collection("orders").doc(orderId).get();

  if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

  const order = orderSnap.data();

  await db.collection("disputes").add({
    orderId,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    reason,
    status: "open",
    createdAt: now(),
  });

  await db.collection("orders").doc(orderId).update({ status: "disputed" });

  res.json({ success: true });
});

/* ======================================================
   ADMIN RESOLVE DISPUTE
====================================================== */
app.post("/admin/dispute/resolve", async (req, res) => {
  const { disputeId, action } = req.body;

  const disputeRef = db.collection("disputes").doc(disputeId);
  const disputeSnap = await disputeRef.get();
  if (!disputeSnap.exists) return res.status(404).json({ error: "Dispute not found" });

  const dispute = disputeSnap.data();
  const orderRef = db.collection("orders").doc(dispute.orderId);
  const orderSnap = await orderRef.get();
  const order = orderSnap.data();

  if (action === "refund") {
    await orderRef.update({ status: "refunded" });
  }

  if (action === "release") {
    const walletRef = db.collection("wallets").doc(order.sellerId);
    await db.runTransaction(async tx => {
      tx.update(walletRef, {
        pending: admin.firestore.FieldValue.increment(-order.amount),
        available: admin.firestore.FieldValue.increment(order.amount),
      });
      tx.update(orderRef, { status: "completed" });
    });
  }

  await disputeRef.update({ status: "resolved", resolution: action });

  res.json({ success: true });
});

/* ======================================================
   ADS
====================================================== */
app.post("/ads/create", async (req, res) => {
  const { ownerId, productId, type, budget } = req.body;

  await db.collection("ads").add({
    ownerId,
    productId: productId || null,
    type,
    budget,
    spent: 0,
    status: "active",
    createdAt: now(),
  });

  res.json({ success: true });
});

app.get("/ads", async (_, res) => {
  const snap = await db.collection("ads").where("status", "==", "active").get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

/* ======================================================
   WITHDRAWALS (KYC REQUIRED)
====================================================== */
app.post("/withdraw", async (req, res) => {
  const { userId, amount } = req.body;

  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.data().kycVerified) {
    return res.status(403).json({ error: "KYC not verified" });
  }

  const walletRef = db.collection("wallets").doc(userId);
  const walletSnap = await walletRef.get();

  if (walletSnap.data().available < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  await walletRef.update({
    available: admin.firestore.FieldValue.increment(-amount),
  });

  await db.collection("withdrawals").add({
    userId,
    amount,
    status: "pending",
    createdAt: now(),
  });

  res.json({ success: true });
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend running on", PORT));
