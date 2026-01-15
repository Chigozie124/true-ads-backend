import "dotenv/config";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import crypto from "crypto";
import axios from "axios";

/* ================= APP ================= */
const app = express();
app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

/* ================= FIREBASE (SAFE BASE64) ================= */
if (!process.env.FIREBASE_ADMIN_B64) {
  throw new Error("FIREBASE_ADMIN_B64 missing");
}

const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_ADMIN_B64, "base64").toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

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
    .add({ title, message, read: false, createdAt: now() });
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
      }
    }
  }
}, 1000 * 60 * 60);

/* ================= USERS ================= */
app.get("/user/:uid", async (req, res) => {
  const snap = await db.collection("users").doc(req.params.uid).get();
  if (!snap.exists) return res.status(404).json({ error: "User not found" });

  await ensureWallet(req.params.uid);
  const wallet = await db.collection("wallets").doc(req.params.uid).get();

  res.json({ uid: req.params.uid, ...snap.data(), wallet: wallet.data() });
});

/* ================= WATCH ADS ================= */
app.post("/ads/watch", async (req, res) => {
  const { uid } = req.body;
  const ref = db.collection("adRewards").doc(uid);
  const snap = await ref.get();

  const today = new Date().toDateString();
  if (snap.exists && snap.data().lastDay === today)
    return res.status(429).json({ error: "Daily limit reached" });

  await ensureWallet(uid);
  await db.collection("wallets").doc(uid)
    .update({ available: admin.firestore.FieldValue.increment(50) });

  await ref.set({ lastDay: today });
  res.json({ success: true, reward: 50 });
});

/* ================= SELLER UPGRADE ================= */
app.post("/user/upgrade", async (req, res) => {
  await db.collection("users").doc(req.body.uid)
    .update({ isSeller: true, upgraded: true });
  res.json({ success: true });
});

/* ================= REFERRALS ================= */
app.post("/referral", async (req, res) => {
  const { uid, referredBy } = req.body;
  if (uid === referredBy) return res.status(400).json({ error: "Invalid referral" });

  const ref = db.collection("users").doc(uid);
  if ((await ref.get()).data()?.referredBy) return res.json({ ignored: true });

  await ref.update({ referredBy });
  await ensureWallet(referredBy);

  await db.collection("wallets").doc(referredBy)
    .update({ available: admin.firestore.FieldValue.increment(200) });

  res.json({ success: true });
});

/* ================= PAYMENTS INIT ================= */
app.post("/payments/init", async (req, res) => {
  const { buyerId, productId } = req.body;

  const product = await db.collection("products").doc(productId).get();
  if (!product.exists) return res.status(404).json({ error: "Product missing" });

  const buyer = await db.collection("users").doc(buyerId).get();
  if (buyer.data()?.banned) return res.status(403).json({ error: "Banned" });

  const reference = `TRUADS_${Date.now()}`;

  await db.collection("payments").doc(reference).set({
    buyerId,
    sellerId: product.data().sellerId,
    productId,
    amount: product.data().price,
    status: "pending",
    createdAt: now()
  });

  const pay = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    {
      email: buyer.data().email,
      amount: product.data().price * 100,
      reference,
      callback_url: `${FRONTEND_URL}/payment-success.html`,
      currency: "NGN"
    },
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
  );

  res.json(pay.data.data);
});

/* ================= PAYSTACK WEBHOOK ================= */
app.post("/paystack/webhook", async (req, res) => {
  const hash = crypto.createHmac("sha512", PAYSTACK_WEBHOOK_SECRET)
    .update(req.rawBody).digest("hex");

  if (hash !== req.headers["x-paystack-signature"])
    return res.sendStatus(401);

  const evt = req.body;
  if (evt.event === "charge.success") {
    const ref = evt.data.reference;
    const pay = await db.collection("payments").doc(ref).get();
    if (!pay.exists) return res.sendStatus(200);

    await ensureWallet(pay.data().sellerId);

    await db.runTransaction(tx => {
      tx.update(pay.ref, { status: "paid" });
      tx.update(db.collection("wallets").doc(pay.data().sellerId), {
        pending: admin.firestore.FieldValue.increment(pay.data().amount),
        updatedAt: now()
      });
      tx.set(db.collection("orders").doc(ref), {
        ...pay.data(),
        status: "paid",
        createdAt: now()
      });
    });
  }
  res.sendStatus(200);
});

/* ================= WITHDRAWALS ================= */
app.post("/withdraw", async (req, res) => {
  const { uid, amount } = req.body;
  const wallet = await db.collection("wallets").doc(uid).get();

  if (wallet.data().available < amount)
    return res.status(400).json({ error: "Insufficient funds" });

  await wallet.ref.update({
    available: admin.firestore.FieldValue.increment(-amount)
  });

  await db.collection("withdrawals").add({
    uid, amount, status: "pending", createdAt: now()
  });

  res.json({ success: true });
});

/* ================= ADMIN ================= */
app.post("/admin/withdraw/approve", async (req, res) => {
  await db.collection("withdrawals").doc(req.body.id)
    .update({ status: "approved" });
  res.json({ success: true });
});

/* ================= HEALTH ================= */
app.get("/health", (_, res) => {
  res.json({ status: "OK", paystack: !!PAYSTACK_SECRET });
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 True-Ads Backend running on ${PORT}`)
);
