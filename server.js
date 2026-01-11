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
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_JSON)),
});

const db = admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

/* ================= PAYSTACK ================= */
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = "https://api.paystack.co";

/* ================= HELPERS ================= */
const fetchPaystack = async (endpoint, method = "GET", body = null) => {
  const options = { method, headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${PAYSTACK_BASE}${endpoint}`, options);
  return res.json();
};

/* ================= USERS ================= */
app.post("/users/create", async (req, res) => {
  try {
    const { uid, name, email } = req.body;

    // Create user doc
    await db.collection("users").doc(uid).set({
      name,
      email,
      role: "user",
      banned: false,
      rating: 100,
      verified: false,
      kycVerified: false,
      verificationEligible: false,
      createdAt: now(),
    });

    // Create wallet
    await db.collection("wallets").doc(uid).set({
      available: 0,
      pending: 0,
      totalEarned: 0,
      updatedAt: now(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Get user info with ban/rating check
app.get("/user/:uid", async (req, res) => {
  const { uid } = req.params;
  try {
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) return res.status(404).json({ error: "User not found" });
    const walletSnap = await db.collection("wallets").doc(uid).get();

    const userData = userSnap.data();
    const walletData = walletSnap.exists ? walletSnap.data() : { available: 0, pending: 0 };

    // Auto-ban if rating is 0
    if (userData.rating <= 0 && !userData.banned) {
      await db.collection("users").doc(uid).update({ banned: true });
      userData.banned = true;
    }

    res.json({
      uid,
      name: userData.name,
      email: userData.email,
      role: userData.role,
      banned: userData.banned,
      rating: userData.rating,
      verified: userData.verified,
      kycVerified: userData.kycVerified,
      wallet: walletData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get user info" });
  }
});

/* ================= NOTIFICATIONS ================= */
app.get("/notifications/:uid", async (req, res) => {
  const { uid } = req.params;
  try {
    const notifSnap = await db
      .collection("notifications")
      .doc(uid)
      .collection("items")
      .orderBy("createdAt", "desc")
      .get();

    const notifications = notifSnap.empty ? [] : notifSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(notifications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

/* ================= PRODUCTS ================= */
app.post("/products/create", async (req, res) => {
  const { sellerId, title, price, category, imageUrl } = req.body;
  try {
    const sellerSnap = await db.collection("users").doc(sellerId).get();
    if (!sellerSnap.exists) return res.status(404).json({ error: "Seller not found" });

    await db.collection("products").add({
      sellerId,
      sellerName: sellerSnap.data().name,
      sellerEmail: sellerSnap.data().email,
      title,
      price,
      category: category || "General",
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

/* ================= ORDERS & PAYMENTS ================= */
// Initialize Paystack payment
app.post("/orders/initiate", async (req, res) => {
  const { buyerId, productId } = req.body;
  try {
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) return res.status(404).json({ error: "Product not found" });

    const product = productSnap.data();
    const buyerSnap = await db.collection("users").doc(buyerId).get();
    if (!buyerSnap.exists) return res.status(404).json({ error: "Buyer not found" });

    // Initialize payment
    const paystackRes = await fetchPaystack("/transaction/initialize", "POST", {
      amount: product.price * 100, // kobo
      email: buyerSnap.data().email,
      metadata: { productId, buyerId, sellerId: product.sellerId },
      callback_url: process.env.PAYSTACK_CALLBACK_URL,
    });

    // Save order as "pending"
    const orderRef = await db.collection("orders").add({
      buyerId,
      sellerId: product.sellerId,
      productId,
      amount: product.price,
      status: "pending",
      paystackRef: paystackRes.data.reference,
      createdAt: now(),
    });

    res.json({ success: true, orderId: orderRef.id, paystackRef: paystackRes.data.reference, paymentUrl: paystackRes.data.authorization_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to initiate order" });
  }
});

// Paystack webhook to confirm payment
app.post("/orders/paystack-webhook", async (req, res) => {
  try {
    const sig = req.headers["x-paystack-signature"];
    const secret = process.env.PAYSTACK_SECRET_KEY;

    const crypto = await import("crypto");
    const hash = crypto.createHmac("sha512", secret).update(JSON.stringify(req.body)).digest("hex");
    if (hash !== sig) return res.status(401).send("Invalid signature");

    const event = req.body;
    if (event.event === "charge.success") {
      const ref = event.data.reference;
      const orderQuery = await db.collection("orders").where("paystackRef", "==", ref).get();
      if (orderQuery.empty) return res.status(404).send("Order not found");

      const orderRef = orderQuery.docs[0].ref;
      const order = orderQuery.docs[0].data();

      // Update order status
      await orderRef.update({ status: "paid", paidAt: now() });

      // Update wallet pending for seller
      const walletRef = db.collection("wallets").doc(order.sellerId);
      await walletRef.set({ pending: admin.firestore.FieldValue.increment(order.amount) }, { merge: true });

      // Notify seller
      await db.collection("notifications").doc(order.sellerId).collection("items").add({
        title: "New Order",
        body: `You received a new order for ${order.amount}₦`,
        read: false,
        createdAt: now(),
      });
    }

    res.send("ok");
  } catch (err) {
    console.error(err);
    res.status(500).send("Webhook failed");
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
      tx.update(orderRef, { status: "completed", completedAt: now() });
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to confirm delivery" });
  }
});

/* ================= VERIFICATIONS & RATINGS ================= */
app.post("/verify/initiate", async (req, res) => {
  const { userId, amount } = req.body;
  try {
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ error: "User not found" });

    const paystackRes = await fetchPaystack("/transaction/initialize", "POST", {
      amount: amount * 100,
      email: userSnap.data().email,
      metadata: { userId, type: "verification" },
      callback_url: process.env.PAYSTACK_CALLBACK_URL,
    });

    res.json({ success: true, paymentUrl: paystackRes.data.authorization_url, paystackRef: paystackRes.data.reference });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to initiate verification" });
  }
});

// Auto-ban if rating = 0 and auto-verify if rating = 100
app.post("/verify/update-rating", async (req, res) => {
  const { userId, rating } = req.body;
  try {
    const userRef = db.collection("users").doc(userId);
    await userRef.update({ rating });

    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: "User not found" });
    const data = userSnap.data();

    if (rating >= 100 && !data.verified) await userRef.update({ verified: true });
    if (rating <= 0 && !data.banned) await userRef.update({ banned: true });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update rating" });
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

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
