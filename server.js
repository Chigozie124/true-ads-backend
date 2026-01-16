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
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

/* ================= FIREBASE ADMIN ================= */
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_ADMIN_B64, "base64").toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

/* ================= CONFIG ================= */
const FRONTEND_URL = process.env.FRONTEND_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = "7d";

const PAYSTACK_SECRET =
  process.env.PAYSTACK_MODE === "live"
    ? process.env.PAYSTACK_SECRET_LIVE_KEY
    : process.env.PAYSTACK_SECRET_TEST_KEY;

const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;

/* ================= JWT ================= */
const signJWT = (uid) =>
  jwt.sign({ uid }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

const verifyJWT = (token) =>
  jwt.verify(token, JWT_SECRET);

/* ================= AUTH GUARDS ================= */
const authGuard = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = verifyJWT(token);
    req.uid = decoded.uid;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

const adminGuard = async (req, res, next) => {
  const user = await db.collection("users").doc(req.uid).get();
  if (user.data()?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
};

/* ================= HELPERS ================= */
const ensureWallet = async (uid) => {
  const ref = db.collection("wallets").doc(uid);
  if (!(await ref.get()).exists) {
    await ref.set({
      available: 0,
      pending: 0,
      totalEarned: 0,
      updatedAt: now()
    });
  }
};

const notify = async (uid, title, message) => {
  await db.collection("notifications")
    .doc(uid)
    .collection("items")
    .add({
      title,
      message,
      read: false,
      createdAt: now()
    });
};

/* ================= AUTH (FIREBASE FIRST) ================= */
app.post("/signup", async (req, res) => {
  const { uid, email, name } = req.body;

  await db.collection("users").doc(uid).set({
    email,
    name,
    role: "user",
    banned: false,
    isSeller: false,
    createdAt: now()
  });

  await ensureWallet(uid);
  await notify(uid, "Welcome 🎉", "Your account has been created successfully.");

  res.json({ token: signJWT(uid) });
});

app.post("/login", async (req, res) => {
  const { uid } = req.body;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return res.status(404).json({ error: "User not found" });

  res.json({ token: signJWT(uid) });
});

/* ================= USER ================= */
app.get("/user/me", authGuard, async (req, res) => {
  const user = await db.collection("users").doc(req.uid).get();
  await ensureWallet(req.uid);
  const wallet = await db.collection("wallets").doc(req.uid).get();

  res.json({
    uid: req.uid,
    ...user.data(),
    wallet: wallet.data()
  });
});

/* ================= PRODUCTS ================= */
app.get("/products", async (_, res) => {
  const snap = await db.collection("products")
    .where("available", "==", true)
    .get();

  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.post("/products", authGuard, async (req, res) => {
  const user = await db.collection("users").doc(req.uid).get();
  if (!user.data()?.isSeller && user.data()?.role !== "admin") {
    return res.status(403).json({ error: "Seller only" });
  }

  const product = {
    ...req.body,
    sellerId: req.uid,
    sellerName: user.data().name,
    available: true,
    createdAt: now()
  };

  const ref = await db.collection("products").add(product);
  res.json({ id: ref.id });
});

/* ================= NOTIFICATIONS ================= */
app.get("/notifications", authGuard, async (req, res) => {
  const snap = await db.collection("notifications")
    .doc(req.uid)
    .collection("items")
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

/* 🔥 TEST NOTIFICATION (VERY IMPORTANT) */
app.post("/notifications/test", authGuard, async (req, res) => {
  await notify(
    req.uid,
    "Test Notification ✅",
    "If you see this, notifications are working correctly."
  );
  res.json({ success: true });
});

/* ================= WATCH ADS ================= */
app.post("/ads/watch", authGuard, async (req, res) => {
  const ref = db.collection("adRewards").doc(req.uid);
  const today = new Date().toDateString();

  if ((await ref.get()).data()?.day === today) {
    return res.status(429).json({ error: "Daily limit reached" });
  }

  await ensureWallet(req.uid);
  await db.collection("wallets").doc(req.uid)
    .update({ available: admin.firestore.FieldValue.increment(50) });

  await ref.set({ day: today });
  await notify(req.uid, "Ad Reward 💰", "You earned ₦50");

  res.json({ reward: 50 });
});

/* ================= PAYMENTS ================= */
app.post("/payments/init", authGuard, async (req, res) => {
  const product = await db.collection("products").doc(req.body.productId).get();
  if (!product.exists) return res.status(404).json({ error: "Product not found" });

  const reference = `TRUADS_${Date.now()}`;

  await db.collection("payments").doc(reference).set({
    buyerId: req.uid,
    sellerId: product.data().sellerId,
    productId: product.id,
    amount: product.data().price,
    status: "pending",
    createdAt: now()
  });

  const pay = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    {
      email: req.body.email,
      amount: product.data().price * 100,
      reference,
      callback_url: `${FRONTEND_URL}/payment-success.html`
    },
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
  );

  res.json(pay.data.data);
});

/* ================= PAYSTACK WEBHOOK ================= */
app.post("/paystack/webhook", async (req, res) => {
  const hash = crypto.createHmac("sha512", PAYSTACK_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) return res.sendStatus(401);

  if (req.body.event === "charge.success") {
    const ref = req.body.data.reference;
    const pay = await db.collection("payments").doc(ref).get();
    if (!pay.exists) return res.sendStatus(200);

    await ensureWallet(pay.data().sellerId);

    await db.runTransaction(async tx => {
      tx.update(pay.ref, { status: "paid" });
      tx.update(
        db.collection("wallets").doc(pay.data().sellerId),
        { pending: admin.firestore.FieldValue.increment(pay.data().amount) }
      );
      tx.update(
        db.collection("products").doc(pay.data().productId),
        { available: false }
      );
    });

    await notify(pay.data().sellerId, "Product Sold 🎉", "You made a sale!");
  }

  res.sendStatus(200);
});

/* ================= DISPUTES ================= */
app.post("/dispute", authGuard, async (req, res) => {
  await db.collection("disputes").add({
    uid: req.uid,
    ...req.body,
    status: "pending",
    createdAt: now()
  });

  res.json({ success: true });
});

/* ================= ADMIN ================= */
app.get("/admin/users", authGuard, adminGuard, async (_, res) => {
  const users = await db.collection("users").get();
  res.json(users.docs.map(u => ({ uid: u.id, ...u.data() })));
});

app.get("/admin/products", authGuard, adminGuard, async (_, res) => {
  const snap = await db.collection("products").get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.get("/admin/disputes", authGuard, adminGuard, async (_, res) => {
  const snap = await db.collection("disputes").get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

/* ================= HEALTH ================= */
app.get("/health", (_, res) => res.json({ status: "OK" }));

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend running on ${PORT}`));
