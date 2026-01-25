import "dotenv/config";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import crypto from "crypto";
import axios from "axios";
import jwt from "jsonwebtoken";

/* ================= APP ================= */
const app = express();
app.use(cors());
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

/* ================= FIREBASE ================= */
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_ADMIN_B64, "base64").toString("utf8")
);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

/* ================= PAYSTACK ================= */
const PAYSTACK_MODE = process.env.PAYSTACK_MODE || "test";
const PAYSTACK_SECRET =
  PAYSTACK_MODE === "live"
    ? process.env.PAYSTACK_SECRET_LIVE_KEY
    : process.env.PAYSTACK_SECRET_TEST_KEY;
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;

/* ================= JWT ================= */
const JWT_SECRET = process.env.JWT_SECRET || "supersecretjwtkey";
const JWT_EXPIRES_IN = "7d";
const signJWT = (uid) => jwt.sign({ uid }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
const verifyJWT = (token) => jwt.verify(token, JWT_SECRET);

/* ================= HELPERS ================= */
const ensureWallet = async (uid) => {
  const ref = db.collection("wallets").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    const walletData = { available: 0, pending: 0, totalEarned: 0, updatedAt: now() };
    await ref.set(walletData);
    return walletData;
  }
  return snap.data();
};

const notify = async (uid, title, message) => {
  await db.collection("notifications").doc(uid).collection("items").add({
    title,
    message,
    read: false,
    createdAt: now(),
  });
};

/* ================= AUTH GUARDS ================= */
const authGuard = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.uid = verifyJWT(token).uid;
    next();
  } catch (err) {
    console.error("JWT verification error:", err);
    return res.status(401).json({ error: "Invalid/expired token" });
  }
};

const adminGuard = async (req, res, next) => {
  const user = await db.collection("users").doc(req.uid).get();
  const role = user.data()?.role;
  if (!["admin", "subadmin"].includes(role)) return res.status(403).json({ error: "Forbidden" });
  req.role = role;
  next();
};

/* ================= USERS ================= */
app.post("/signup", async (req, res) => {
  try {
    const { uid, email, name } = req.body;
    if (!uid || !email || !name) return res.status(400).json({ error: "Missing fields" });

    await db.collection("users").doc(uid).set({
      email,
      name,
      banned: false,
      role: "user",
      isSeller: false,
      verified: false,
    });

    await ensureWallet(uid);
    const token = signJWT(uid);
    res.json({ token, uid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "UID is required" });

    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });

    const token = signJWT(uid);
    res.json({ token, uid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/user/:uid", authGuard, async (req, res) => {
  try {
    const snap = await db.collection("users").doc(req.params.uid).get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });

    const wallet = await ensureWallet(req.params.uid);
    res.json({ uid: req.params.uid, ...snap.data(), wallet });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get user" });
  }
});

/* ================= PRODUCTS ================= */
app.get("/products", async (req, res) => {
  try {
    const snap = await db.collection("products").where("available", "==", true).get();
    const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load products" });
  }
});

app.post("/products/add", authGuard, async (req, res) => {
  try {
    const { name, price, description, imageUrl } = req.body;
    if (!name || !price || !description || !imageUrl) return res.status(400).json({ error: "Missing fields" });

    const userSnap = await db.collection("users").doc(req.uid).get();
    if (!userSnap.data()?.isSeller) return res.status(403).json({ error: "Only sellers can add products" });

    const productRef = await db.collection("products").add({
      name,
      price,
      description,
      imageUrl,
      sellerId: req.uid,
      sellerName: userSnap.data().name,
      available: true,
      createdAt: now(),
    });

    res.json({ success: true, id: productRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add product" });
  }
});

app.post("/products/delete/:id", authGuard, adminGuard, async (req, res) => {
  try {
    await db.collection("products").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

/* ================= PRODUCTS SEARCH ================= */
app.get("/products/search", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.trim() === "") return res.status(400).json({ error: "Search query required" });

    const snap = await db.collection("products").where("available", "==", true).get();
    const results = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => 
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.description.toLowerCase().includes(query.toLowerCase())
      );

    res.json(results);
  } catch (err) {
    console.error("Product search error:", err);
    res.status(500).json({ error: "Failed to search products" });
  }
});

/* ================= NOTIFICATIONS ================= */
app.get("/notifications/:uid", authGuard, async (req, res) => {
  try {
    const snap = await db
      .collection("notifications")
      .doc(req.params.uid)
      .collection("items")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const notifs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(notifs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get notifications" });
  }
});

app.post("/notifications/mark-read", authGuard, async (req, res) => {
  try {
    const { notificationIds } = req.body;
    if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      return res.status(400).json({ error: "notificationIds array is required" });
    }

    const batch = db.batch();
    notificationIds.forEach(id => {
      const ref = db.collection("notifications").doc(req.uid).collection("items").doc(id);
      batch.update(ref, { read: true });
    });

    await batch.commit();
    res.json({ success: true, updated: notificationIds.length });
  } catch (err) {
    console.error("Mark notifications read error:", err);
    res.status(500).json({ error: "Failed to mark notifications as read" });
  }
});

/* ================= ADS ================= */
const FREE_AD_DURATION = 10 * 60 * 1000; // 10 minutes
const adSessions = {}; // in-memory tracking for simplicity

app.post("/ads/watch", authGuard, async (req, res) => {
  try {
    const uid = req.uid;
    const lastWatched = adSessions[uid] || 0;
    if (Date.now() - lastWatched < FREE_AD_DURATION) {
      return res.status(429).json({ error: "Free ad cooldown active" });
    }

    adSessions[uid] = Date.now();
    await ensureWallet(uid);

    await db.collection("wallets").doc(uid).update({
      available: admin.firestore.FieldValue.increment(1),
    });

    await notify(uid, "Ad Watched", "You earned 1 free ad point!");
    res.json({ success: true, reward: 1 });
  } catch (err) {
    console.error("Ad watch error:", err);
    res.status(500).json({ error: "Failed to process ad" });
  }
});

/* ================= SELLER UPGRADE ================= */
app.post("/user/upgrade", authGuard, async (req, res) => {
  try {
    await db.collection("users").doc(req.uid).update({
      isSeller: true,
      upgraded: true,
      verified: false,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Upgrade error:", err);
    res.status(500).json({ error: "Failed to upgrade user" });
  }
});

/* ================= PAYMENTS / ESCROW ================= */
app.post("/payments/init", authGuard, async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: "Product ID required" });

    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) return res.status(404).json({ error: "Product not found" });

    const buyerSnap = await db.collection("users").doc(req.uid).get();
    if (buyerSnap.data()?.banned) return res.status(403).json({ error: "Banned" });

    const reference = `TRUADS_${Date.now()}`;
    await db.collection("payments").doc(reference).set({
      buyerId: req.uid,
      sellerId: productSnap.data().sellerId,
      productId,
      amount: productSnap.data().price,
      status: "pending",
      createdAt: now(),
    });

    const pay = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: buyerSnap.data().email,
        amount: productSnap.data().price * 100,
        reference,
        callback_url: `${FRONTEND_URL}/payment-success.html`,
        currency: "NGN",
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    res.json(pay.data.data);
  } catch (err) {
    console.error("Payment init error:", err);
    res.status(500).json({ error: "Failed to initialize payment" });
  }
});

app.post("/paystack/webhook", async (req, res) => {
  try {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) return res.sendStatus(401);

    const evt = req.body;
    if (evt.event === "charge.success") {
      const ref = evt.data.reference;
      const paySnap = await db.collection("payments").doc(ref).get();
      if (!paySnap.exists) return res.sendStatus(200);

      await ensureWallet(paySnap.data().sellerId);

      await db.runTransaction(async (tx) => {
        tx.update(paySnap.ref, { status: "paid" });
        tx.update(db.collection("wallets").doc(paySnap.data().sellerId), {
          pending: admin.firestore.FieldValue.increment(paySnap.data().amount),
          updatedAt: now(),
        });
        tx.set(db.collection("orders").doc(ref), {
          ...paySnap.data(),
          status: "paid",
          createdAt: now(),
        });
        tx.update(db.collection("products").doc(paySnap.data().productId), { available: false });
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Paystack webhook error:", err);
    res.sendStatus(500);
  }
});

/* ================= WITHDRAWALS ================= */
app.post("/withdraw", authGuard, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    const walletSnap = await db.collection("wallets").doc(req.uid).get();
    const available = walletSnap.data()?.available || 0;

    if (available < amount) return res.status(400).json({ error: "Insufficient funds" });

    await walletSnap.ref.update({ available: admin.firestore.FieldValue.increment(-amount) });
    await db.collection("withdrawals").add({
      uid: req.uid,
      amount,
      status: "pending",
      createdAt: now(),
    });

    await notify(req.uid, "Withdrawal", `${amount} withdrawal requested.`);
    res.json({ success: true });
  } catch (err) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: "Failed to process withdrawal" });
  }
});

/* ================= DISPUTES ================= */
app.post("/dispute", authGuard, async (req, res) => {
  try {
    const { reason, orderId } = req.body;
    if (!reason || !orderId) return res.status(400).json({ error: "Missing reason or orderId" });

    await db.collection("disputes").add({ uid: req.uid, orderId, reason, status: "pending", createdAt: now() });
    res.json({ success: true });
  } catch (err) {
    console.error("Dispute error:", err);
    res.status(500).json({ error: "Failed to create dispute" });
  }
});

/* ================= RATINGS ================= */
app.post("/ratings", authGuard, async (req, res) => {
  try {
    const { ratedUid, rating, review } = req.body;
    if (!ratedUid || !rating) return res.status(400).json({ error: "Missing ratedUid or rating" });

    await db.collection("ratings").add({
      ratedUid,
      reviewerUid: req.uid,
      rating,
      review: review || "",
      createdAt: now(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Ratings error:", err);
    res.status(500).json({ error: "Failed to submit rating" });
  }
});

/* ================= ADMIN / SUBADMIN ================= */
app.get("/admin/users", authGuard, adminGuard, async (req, res) => {
  try {
    const usersSnap = await db.collection("users").get();
    const walletsSnap = await db.collection("wallets").get();

    const walletMap = {};
    walletsSnap.docs.forEach((d) => { walletMap[d.id] = d.data(); });

    res.json(usersSnap.docs.map((u) => ({ uid: u.id, ...u.data(), balance: walletMap[u.id]?.available || 0 })));
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.get("/admin/products", authGuard, adminGuard, async (req, res) => {
  try {
    const snap = await db.collection("products").get();
    res.json(snap.docs.map((p) => ({ id: p.id, ...p.data() })));
  } catch (err) {
    console.error("Admin products error:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.get("/admin/orders", authGuard, adminGuard, async (req, res) => {
  try {
    const snap = await db.collection("orders").get();
    res.json(snap.docs.map((o) => ({ id: o.id, ...o.data() })));
  } catch (err) {
    console.error("Admin orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

app.get("/admin/disputes", authGuard, adminGuard, async (req, res) => {
  try {
    const snap = await db.collection("disputes").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error("Admin disputes error:", err);
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
});

app.post("/admin/ban/:uid", authGuard, adminGuard, async (req, res) => {
  try {
    if (req.role !== "admin") return res.status(403).json({ error: "Only main admin can ban" });
    await db.collection("users").doc(req.params.uid).update({ banned: true });
    res.json({ success: true });
  } catch (err) {
    console.error("Admin ban error:", err);
    res.status(500).json({ error: "Failed to ban user" });
  }
});

app.post("/admin/unban/:uid", authGuard, adminGuard, async (req, res) => {
  try {
    if (req.role !== "admin") return res.status(403).json({ error: "Only main admin can unban" });
    await db.collection("users").doc(req.params.uid).update({ banned: false });
    res.json({ success: true });
  } catch (err) {
    console.error("Admin unban error:", err);
    res.status(500).json({ error: "Failed to unban user" });
  }
});

/* ================= CHAT METADATA ================= */
app.get("/chats/:uid", authGuard, async (req, res) => {
  try {
    const snap = await db.collection("chats").where("participants", "array-contains", req.uid).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error("Chats fetch error:", err);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

/* ================= HEALTH CHECK ================= */
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    paystackConfigured: !!PAYSTACK_SECRET,
    env: PAYSTACK_MODE,
  });
});

/* ================= FRONTEND-READY ROUTES ================= */
// Optional: catch-all for frontend routing (for single-page apps)
/* ================= 404 HANDLER ================= */
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

/* ================= GLOBAL ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 True-Ads Backend running on port ${PORT}`);
  console.log(`🚀 Paystack mode: ${PAYSTACK_MODE}, Frontend URL: ${FRONTEND_URL}`);
});
