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

/* ================= USERS ================= */
// Get user info
app.get("/user/:uid", async (req, res) => {
  const { uid } = req.params;
  try {
    const userSnap = await db.collection("users").doc(uid).get();
    const walletSnap = await db.collection("wallets").doc(uid).get();

    if (!userSnap.exists) return res.status(404).json({ error: "User not found" });

    const userData = userSnap.data();
    const walletData = walletSnap.exists ? walletSnap.data() : { available: 0, pending: 0 };

    res.json({
      uid,
      name: userData.name,
      email: userData.email,
      isSeller: userData.isSeller || false,
      kycVerified: userData.kycVerified || false,
      wallet: walletData
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get user info" });
  }
});

/* ================= PRODUCTS ================= */
app.post("/products/create", async (req, res) => {
  const { sellerId, title, price, imageUrl } = req.body;
  try {
    await db.collection("products").add({
      sellerId,
      title,
      price,
      imageUrl: imageUrl || null,
      status: "active",
      createdAt: now(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create product" });
  }
});

app.get("/products", async (_, res) => {
  try {
    const snap = await db.collection("products").where("status", "==", "active").get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

/* ================= ADS ================= */
app.post("/ads/create", async (req, res) => {
  const { ownerId, productId, type, budget } = req.body;
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create ad" });
  }
});

app.get("/ads", async (_, res) => {
  try {
    const snap = await db.collection("ads").where("status", "==", "active").get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch ads" });
  }
});

/* ================= ORDERS ================= */
app.post("/orders/create", async (req, res) => {
  const { buyerId, productId } = req.body;
  try {
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) return res.status(404).json({ error: "Product not found" });

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// Confirm delivery
app.post("/orders/confirm-delivery", async (req, res) => {
  const { orderId } = req.body;
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to confirm delivery" });
  }
});

/* ================= DISPUTES ================= */
app.post("/disputes/open", async (req, res) => {
  const { orderId, reason } = req.body;
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to open dispute" });
  }
});

app.post("/disputes/resolve", async (req, res) => {
  const { disputeId, action } = req.body;
  try {
    const disputeRef = db.collection("disputes").doc(disputeId);
    const disputeSnap = await disputeRef.get();
    if (!disputeSnap.exists) return res.status(404).json({ error: "Dispute not found" });

    const dispute = disputeSnap.data();
    const orderRef = db.collection("orders").doc(dispute.orderId);
    const orderSnap = await orderRef.get();
    const order = orderSnap.data();

    if (action === "refund") await orderRef.update({ status: "refunded" });
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to resolve dispute" });
  }
});

/* ================= WITHDRAWALS ================= */
app.post("/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  try {
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists || !userSnap.data().kycVerified) return res.status(403).json({ error: "KYC not verified" });

    const walletRef = db.collection("wallets").doc(userId);
    const walletSnap = await walletRef.get();
    if (!walletSnap.exists || walletSnap.data().available < amount)
      return res.status(400).json({ error: "Insufficient balance" });

    await walletRef.update({ available: admin.firestore.FieldValue.increment(-amount) });
    await db.collection("withdrawals").add({ userId, amount, status: "pending", createdAt: now() });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process withdrawal" });
  }
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend running on", PORT));
