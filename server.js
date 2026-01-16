import "dotenv/config";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import crypto from "crypto";
import axios from "axios";

/* ================= APP ================= */
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json({
  verify: (req, _, buf) => { req.rawBody = buf; }
}));

/* ================= FIREBASE ================= */
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_ADMIN_B64, "base64").toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

/* ================= AUTH ================= */
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) return res.sendStatus(401);

    req.user = await admin.auth().verifyIdToken(token);

    const userSnap = await db.collection("users").doc(req.user.uid).get();
    if (!userSnap.exists) return res.sendStatus(401);
    if (userSnap.data().banned) return res.status(403).json({ error: "Banned" });

    req.userDoc = userSnap.data();
    next();
  } catch {
    res.sendStatus(401);
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.uid !== process.env.ADMIN_UID) return res.sendStatus(403);
  next();
};

/* ================= HELPERS ================= */
const ensureWallet = async uid => {
  const ref = db.collection("wallets").doc(uid);
  if (!(await ref.get()).exists) {
    await ref.set({
      available: 0,
      pending: 0,
      frozen: 0,
      totalEarned: 0,
      updatedAt: now()
    });
  }
};

/* ================= WALLET AUTO RELEASE ================= */
setInterval(async () => {
  const snap = await db.collection("wallets").get();
  const nowMs = Date.now();

  for (const d of snap.docs) {
    const w = d.data();
    if (w.pending > 0 && w.updatedAt?.toMillis) {
      const hrs = (nowMs - w.updatedAt.toMillis()) / 36e5;
      if (hrs >= 24) {
        await d.ref.update({
          available: admin.firestore.FieldValue.increment(w.pending),
          pending: 0,
          updatedAt: now()
        });
      }
    }
  }
}, 60 * 60 * 1000);

/* ================= USER UPGRADES ================= */
app.post("/user/upgrade/seller", auth, async (req, res) => {
  await db.collection("users").doc(req.user.uid)
    .update({ isSeller: true });
  res.json({ success: true });
});

app.post("/user/upgrade/premium", auth, async (req, res) => {
  await db.collection("users").doc(req.user.uid)
    .update({ isPremium: true });
  res.json({ success: true });
});

/* ================= ADS ================= */
app.post("/ads/watch", auth, async (req, res) => {
  const ref = db.collection("adLimits").doc(req.user.uid);
  const snap = await ref.get();
  const today = new Date().toDateString();

  if (snap.exists && snap.data().day === today)
    return res.status(429).json({ error: "Daily limit reached" });

  await ensureWallet(req.user.uid);

  await db.collection("wallets").doc(req.user.uid).update({
    available: admin.firestore.FieldValue.increment(50),
    totalEarned: admin.firestore.FieldValue.increment(50)
  });

  await ref.set({ day: today });
  res.json({ success: true, reward: 50 });
});

/* ================= PAYMENTS INIT ================= */
app.post("/payments/init", auth, async (req, res) => {
  const { productId } = req.body;

  const productSnap = await db.collection("products").doc(productId).get();
  if (!productSnap.exists) return res.sendStatus(404);

  const ref = `TRUADS_${Date.now()}`;

  await db.collection("payments").doc(ref).set({
    buyerId: req.user.uid,
    sellerId: productSnap.data().sellerId,
    productId,
    amount: productSnap.data().price,
    status: "pending",
    createdAt: now()
  });

  const pay = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    {
      email: req.user.email,
      amount: productSnap.data().price * 100,
      reference: ref,
      callback_url: `${process.env.FRONTEND_URL}/payment-success.html`
    },
    { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_TEST_KEY}` } }
  );

  res.json(pay.data.data);
});

/* ================= PAYSTACK WEBHOOK ================= */
app.post("/paystack/webhook", async (req, res) => {
  const hash = crypto.createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET)
    .update(req.rawBody).digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) return res.sendStatus(401);

  if (req.body.event === "charge.success") {
    const ref = req.body.data.reference;
    const paySnap = await db.collection("payments").doc(ref).get();
    if (!paySnap.exists) return res.sendStatus(200);

    const pay = paySnap.data();
    await ensureWallet(pay.sellerId);

    await db.runTransaction(async tx => {
      tx.update(paySnap.ref, { status: "paid" });
      tx.set(db.collection("orders").doc(ref), {
        ...pay,
        status: "paid",
        createdAt: now()
      });
      tx.update(db.collection("wallets").doc(pay.sellerId), {
        pending: admin.firestore.FieldValue.increment(pay.amount)
      });
    });
  }

  res.sendStatus(200);
});

/* ================= ORDER FLOW ================= */
app.post("/orders/deliver", auth, async (req, res) => {
  const orderRef = db.collection("orders").doc(req.body.orderId);
  await orderRef.update({ status: "delivered" });
  res.json({ success: true });
});

app.post("/orders/confirm", auth, async (req, res) => {
  const orderRef = db.collection("orders").doc(req.body.orderId);
  const snap = await orderRef.get();

  await db.runTransaction(async tx => {
    tx.update(orderRef, { status: "completed" });
    tx.update(db.collection("wallets").doc(snap.data().sellerId), {
      pending: admin.firestore.FieldValue.increment(-snap.data().amount),
      available: admin.firestore.FieldValue.increment(snap.data().amount),
      totalEarned: admin.firestore.FieldValue.increment(snap.data().amount)
    });
  });

  res.json({ success: true });
});

/* ================= DISPUTES ================= */
app.post("/disputes/open", auth, async (req, res) => {
  const { orderId, reason } = req.body;
  const orderSnap = await db.collection("orders").doc(orderId).get();

  await db.collection("disputes").add({
    ...orderSnap.data(),
    reason,
    status: "open",
    createdAt: now()
  });

  await db.collection("wallets").doc(orderSnap.data().sellerId).update({
    frozen: admin.firestore.FieldValue.increment(orderSnap.data().amount),
    pending: admin.firestore.FieldValue.increment(-orderSnap.data().amount)
  });

  res.json({ success: true });
});

/* ================= ADMIN ================= */
app.post("/admin/resolve-dispute", auth, adminOnly, async (req, res) => {
  const { disputeId, winnerUid, amount } = req.body;

  await db.collection("wallets").doc(winnerUid).update({
    available: admin.firestore.FieldValue.increment(amount),
    frozen: admin.firestore.FieldValue.increment(-amount)
  });

  await db.collection("disputes").doc(disputeId)
    .update({ status: "resolved" });

  res.json({ success: true });
});

/* ================= HEALTH ================= */
app.get("/health", (_, res) =>
  res.json({ status: "OK", marketplace: "stable-v1" })
);

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 True-Ads Marketplace Backend running on ${PORT}`)
);
