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
const PAYSTACK_SECRET = PAYSTACK_MODE === "live" ? process.env.PAYSTACK_SECRET_LIVE_KEY : process.env.PAYSTACK_SECRET_TEST_KEY;
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
  if (!(await ref.get()).exists) {
    await ref.set({ available: 0, pending: 0, totalEarned: 0, updatedAt: now() });
  }
};

const notify = async (uid, title, message) => {
  await db.collection("notifications").doc(uid).collection("items").add({
    title, message, read: false, createdAt: now()
  });
};

/* ================= WALLET AUTO RELEASE ================= */
const RELEASE_HOURS = 24;
setInterval(async () => {
  const snap = await db.collection("wallets").get();
  const current = Date.now();
  for (const doc of snap.docs) {
    const w = doc.data();
    if (w.pending > 0 && w.updatedAt?.toMillis) {
      const hrs = (current - w.updatedAt.toMillis()) / 36e5;
      if (hrs >= RELEASE_HOURS) {
        await doc.ref.update({
          available: admin.firestore.FieldValue.increment(w.pending),
          pending: 0,
          updatedAt: now()
        });
        notify(doc.id, "Wallet Update", `${w.pending} has been released to your available balance.`);
      }
    }
  }
}, 1000 * 60 * 60);

/* ================= AUTH GUARD ================= */
const authGuard = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing token" });
  try { req.uid = verifyJWT(token).uid; next(); }
  catch { return res.status(401).json({ error: "Invalid/expired token" }); }
};

/* ================= ADMIN GUARD ================= */
const adminGuard = async (req, res, next) => {
  const user = await db.collection("users").doc(req.uid).get();
  if (user.data()?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
};

/* ================= USERS ================= */
app.post("/signup", async (req, res) => {
  const { uid, email, name } = req.body;
  const userRef = db.collection("users").doc(uid);
  await userRef.set({ email, name, banned: false, role: "user", isSeller: false });
  await ensureWallet(uid);
  const token = signJWT(uid);
  res.json({ token, uid });
});

app.post("/login", async (req, res) => {
  const { uid } = req.body;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return res.status(404).json({ error: "User not found" });
  const token = signJWT(uid);
  res.json({ token, uid });
});

app.get("/user/:uid", authGuard, async (req, res) => {
  const snap = await db.collection("users").doc(req.params.uid).get();
  if (!snap.exists) return res.status(404).json({ error: "User not found" });
  await ensureWallet(req.params.uid);
  const wallet = await db.collection("wallets").doc(req.params.uid).get();
  res.json({ uid: req.params.uid, ...snap.data(), wallet: wallet.data() });
});

/* ================= PRODUCTS ================= */
app.get("/products", async (req, res) => {
  try {
    const snap = await db.collection("products").where("available", "==", true).get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load products" });
  }
});

/* ================= NOTIFICATIONS ================= */
app.get("/notifications/:uid", authGuard, async (req, res) => {
  const snap = await db.collection("notifications").doc(req.params.uid).collection("items").orderBy("createdAt", "desc").limit(20).get();
  const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(notifs);
});

/* ================= WATCH ADS ================= */
app.post("/ads/watch", authGuard, async (req, res) => {
  const uid = req.uid;
  const ref = db.collection("adRewards").doc(uid);
  const snap = await ref.get();
  const today = new Date().toDateString();
  if (snap.exists && snap.data().lastDay === today) return res.status(429).json({ error: "Daily limit reached" });

  await ensureWallet(uid);
  await db.collection("wallets").doc(uid).update({ available: admin.firestore.FieldValue.increment(50) });
  await ref.set({ lastDay: today });
  notify(uid, "Ad Watched", "You earned 50 from watching ads!");
  res.json({ success: true, reward: 50 });
});

/* ================= SELLER UPGRADE ================= */
app.post("/user/upgrade", authGuard, async (req, res) => {
  await db.collection("users").doc(req.uid).update({ isSeller: true, upgraded: true, verified: false });
  res.json({ success: true });
});

/* ================= REFERRALS ================= */
app.post("/referral", authGuard, async (req, res) => {
  const { referredBy } = req.body;
  if (req.uid === referredBy) return res.status(400).json({ error: "Invalid referral" });
  const ref = db.collection("users").doc(req.uid);
  if ((await ref.get()).data()?.referredBy) return res.json({ ignored: true });
  await ref.update({ referredBy });
  await ensureWallet(referredBy);
  await db.collection("wallets").doc(referredBy).update({ available: admin.firestore.FieldValue.increment(200) });
  notify(referredBy, "Referral Bonus", "You earned 200 for referring a friend!");
  res.json({ success: true });
});

/* ================= PAYMENTS ================= */
app.post("/payments/init", authGuard, async (req, res) => {
  const { productId } = req.body;
  const product = await db.collection("products").doc(productId).get();
  if (!product.exists) return res.status(404).json({ error: "Product missing" });
  const buyer = await db.collection("users").doc(req.uid).get();
  if (buyer.data()?.banned) return res.status(403).json({ error: "Banned" });

  const reference = `TRUADS_${Date.now()}`;
  await db.collection("payments").doc(reference).set({
    buyerId: req.uid,
    sellerId: product.data().sellerId,
    productId,
    amount: product.data().price,
    status: "pending",
    createdAt: now()
  });

  const pay = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    { email: buyer.data().email, amount: product.data().price * 100, reference, callback_url: `${FRONTEND_URL}/payment-success.html`, currency: "NGN" },
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
  );

  res.json(pay.data.data);
});

/* ================= PAYSTACK WEBHOOK ================= */
app.post("/paystack/webhook", async (req, res) => {
  const hash = crypto.createHmac("sha512", PAYSTACK_WEBHOOK_SECRET).update(req.rawBody).digest("hex");
  if (hash !== req.headers["x-paystack-signature"]) return res.sendStatus(401);

  const evt = req.body;
  if (evt.event === "charge.success") {
    const ref = evt.data.reference;
    const pay = await db.collection("payments").doc(ref).get();
    if (!pay.exists) return res.sendStatus(200);

    await ensureWallet(pay.data().sellerId);

    await db.runTransaction(async (tx) => {
      tx.update(pay.ref, { status: "paid" });
      tx.update(db.collection("wallets").doc(pay.data().sellerId), { pending: admin.firestore.FieldValue.increment(pay.data().amount), updatedAt: now() });
      tx.set(db.collection("orders").doc(ref), { ...pay.data(), status: "paid", createdAt: now() });
      tx.update(db.collection("products").doc(pay.data().productId), { available: false }); // remove sold product
    });
  }

  res.sendStatus(200);
});

/* ================= WITHDRAWALS ================= */
app.post("/withdraw", authGuard, async (req, res) => {
  const { amount } = req.body;
  const wallet = await db.collection("wallets").doc(req.uid).get();
  if (wallet.data().available < amount) return res.status(400).json({ error: "Insufficient funds" });

  await wallet.ref.update({ available: admin.firestore.FieldValue.increment(-amount) });
  await db.collection("withdrawals").add({ uid: req.uid, amount, status: "pending", createdAt: now() });
  notify(req.uid, "Withdrawal", `${amount} withdrawal requested.`);
  res.json({ success: true });
});

/* ================= DISPUTES ================= */
app.post("/dispute", authGuard, async (req, res) => {
  const { reason, orderId } = req.body;
  await db.collection("disputes").add({ uid: req.uid, orderId, reason, status: "pending", createdAt: now() });
  res.json({ success: true });
});

/* ================= ADMIN ================= */
app.get("/admin/users", authGuard, adminGuard, async (req, res) => {
  const users = await db.collection("users").get();
  const walletSnap = await db.collection("wallets").get();
  const wallets = {};
  walletSnap.docs.forEach(d => wallets[d.id] = d.data());
  res.json(users.docs.map(u => ({ uid: u.id, ...u.data(), balance: wallets[u.id]?.available || 0 })));
});

app.get("/admin/products", authGuard, adminGuard, async (req, res) => {
  const products = await db.collection("products").get();
  res.json(products.docs.map(p => ({ id: p.id, ...p.data() })));
});

app.get("/admin/orders", authGuard, adminGuard, async (req, res) => {
  const orders = await db.collection("orders").get();
  res.json(orders.docs.map(o => ({ id: o.id, ...o.data() })));
});

app.get("/admin/disputes", authGuard, adminGuard, async (req, res) => {
  const disputes = await db.collection("disputes").get();
  res.json(disputes.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.get("/admin/kyc", authGuard, adminGuard, async (req, res) => {
  const users = await db.collection("users").where("isSeller", "==", true).where("verified", "==", false).get();
  res.json(users.docs.map(u => ({ uid: u.id, ...u.data() })));
});

/* ================= HEALTH ================= */
app.get("/health", (_, res) => res.json({ status: "OK", paystack: !!PAYSTACK_SECRET }));

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 True-Ads Backend running on ${PORT}`));
