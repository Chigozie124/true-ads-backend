import "dotenv/config";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fetch from "node-fetch";
import crypto from "crypto";
import axios from "axios";

/* ================= APP ================= */
const app = express();
app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
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

if (!PAYSTACK_SECRET) console.warn("⚠️ PAYSTACK_SECRET_KEY missing, payments will fail");

/* ================= HELPERS ================= */
const sendNotification = async (uid, title, message) => {
  await db.collection("notifications").doc(uid).collection("items").add({
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
    await ref.set({ available: 0, pending: 0, totalEarned: 0, updatedAt: now() });
  }
};

/* ================= USERS ================= */
app.get("/user/:uid", async (req, res) => {
  const { uid } = req.params;
  try {
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) return res.status(404).json({ error: "User not found" });

    await ensureWallet(uid);
    const walletSnap = await db.collection("wallets").doc(uid).get();

    res.json({ uid, ...userSnap.data(), wallet: walletSnap.data() });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

/* ================= PRODUCTS ================= */
app.get("/products", async (_, res) => {
  try {
    const snap = await db.collection("products").where("status", "==", "available").get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(products);
  } catch {
    res.status(500).json({ error: "Failed to load products" });
  }
});

/* ================= PAYSTACK INIT ================= */
app.post("/payments/init", async (req, res) => {
  try {
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack not configured" });

    const { buyerId, productId } = req.body;
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) return res.status(404).json({ error: "Product not found" });

    const userSnap = await db.collection("users").doc(buyerId).get();
    if (!userSnap.exists) return res.status(404).json({ error: "Buyer not found" });

    if (userSnap.data().banned) return res.status(403).json({ error: "Account banned" });

    const reference = `TRUADS_${Date.now()}`;
    const product = productSnap.data();

    await db.collection("payments").doc(reference).set({
      buyerId, productId, sellerId: product.sellerId, amount: product.price, status: "pending", createdAt: now()
    });

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      { email: userSnap.data().email, amount: product.price * 100, reference },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" } }
    );

    res.json(response.data.data);
  } catch (err) {
    res.status(500).json({ error: "Payment init failed", details: err.response?.data || err.message });
  }
});

/* ================= PAYSTACK WEBHOOK ================= */
app.post("/paystack/webhook", async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const hash = crypto.createHmac("sha512", PAYSTACK_WEBHOOK_SECRET || "")
    .update(req.rawBody)
    .digest("hex");

  if (PAYSTACK_WEBHOOK_SECRET && hash !== signature) return res.sendStatus(400);

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
      tx.update(db.collection("products").doc(payment.productId), { status: "sold" });
      tx.update(db.collection("wallets").doc(payment.sellerId), { pending: admin.firestore.FieldValue.increment(payment.amount) });
      tx.set(db.collection("orders").doc(ref), { ...payment, status: "paid", createdAt: now() });
    });

    await sendNotification(payment.sellerId, "New Order", "You have a new order");
    await sendNotification(payment.buyerId, "Payment Successful", "Your order was placed");
  }

  res.sendStatus(200);
});

/* ================= CONFIRM DELIVERY ================= */
app.post("/orders/confirm", async (req, res) => {
  try {
    const { orderId } = req.body;
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    const order = orderSnap.data();

    await db.runTransaction(async tx => {
      tx.update(db.collection("wallets").doc(order.sellerId), {
        pending: admin.firestore.FieldValue.increment(-order.amount),
        available: admin.firestore.FieldValue.increment(order.amount),
        totalEarned: admin.firestore.FieldValue.increment(order.amount)
      });
      tx.update(orderRef, { status: "completed" });
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Delivery confirm failed" });
  }
});

/* ================= DISPUTES ================= */
app.post("/disputes/open", async (req, res) => {
  try {
    const { orderId, reason } = req.body;
    const orderSnap = await db.collection("orders").doc(orderId).get();
    const order = orderSnap.data();

    await db.collection("disputes").add({ ...order, reason, status: "open", createdAt: now() });
    await db.collection("orders").doc(orderId).update({ status: "disputed" });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Open dispute failed" });
  }
});

/* ================= WITHDRAWALS ================= */
app.post("/withdraw", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const walletRef = db.collection("wallets").doc(userId);
    const walletSnap = await walletRef.get();

    if (!walletSnap.exists || walletSnap.data().available < amount)
      return res.status(400).json({ error: "Insufficient funds" });

    await walletRef.update({ available: admin.firestore.FieldValue.increment(-amount) });
    await db.collection("withdrawals").add({ userId, amount, status: "pending", createdAt: now() });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Withdrawal failed" });
  }
});

/* ================= BAN CHECK ================= */
app.get("/check-ban/:uid", async (req, res) => {
  const snap = await db.collection("users").doc(req.params.uid).get();
  res.json({ banned: snap.data()?.banned || false });
});

/* ================= VERIFICATION / RATINGS ================= */
app.post("/user/rating", async (req, res) => {
  try {
    const { uid, rating } = req.body;
    const userRef = db.collection("users").doc(uid);
    await userRef.update({ rating });

    if (rating >= 100) await userRef.update({ verified: true });
    if (rating <= 0) await userRef.update({ banned: true });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to update rating" });
  }
});

/* ================= WATCH ADS UPGRADE ================= */
app.post("/user/upgrade", async (req, res) => {
  try {
    const { uid } = req.body;
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: "User not found" });

    await userRef.update({ upgraded: true });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Upgrade failed" });
  }
});

/* ================= HEALTH CHECK ================= */
app.get("/", (req, res) => {
  res.json({ status: "OK", paystackConfigured: !!PAYSTACK_SECRET });
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
