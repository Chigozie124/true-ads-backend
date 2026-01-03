import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fs from "fs";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ================= FIREBASE =================
const serviceAccount = JSON.parse(
  fs.readFileSync("./firebase-admin.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ================= PAYSTACK =================
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = "https://api.paystack.co";

// ================= AUTH =================
async function auth(req, res, next) {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return res.status(401).json({ error: "Login required" });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ================= USER =================
app.get("/user", auth, async (req, res) => {
  const snap = await db.collection("users").doc(req.uid).get();
  if (!snap.exists) return res.status(404).json({ error: "User not found" });
  res.json(snap.data());
});

// ================= KYC =================
app.post("/kyc/submit", auth, async (req, res) => {
  const { bankName, accountNumber, phone } = req.body;

  if (!bankName || !accountNumber || !phone) {
    return res.status(400).json({ error: "Missing details" });
  }

  await db.collection("users").doc(req.uid).update({
    bankName,
    accountNumber,
    phone,
    kycStatus: "pending",
  });

  res.json({ success: true, message: "KYC submitted" });
});

app.post("/admin/kyc/verify", async (req, res) => {
  const { userId } = req.body;
  await db.collection("users").doc(userId).update({
    kycStatus: "verified",
  });
  res.json({ success: true });
});

// ================= PRODUCTS =================
app.post("/product/create", auth, async (req, res) => {
  const { title, price, description } = req.body;

  await db.collection("products").add({
    sellerId: req.uid,
    title,
    price,
    description,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.json({ success: true });
});

app.get("/products", async (_, res) => {
  const snap = await db.collection("products").get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

// ================= PAYMENTS INIT =================
app.post("/payment/init", auth, async (req, res) => {
  const { amount, email, type, sellerId } = req.body;

  const metadata = {
    type,
    uid: req.uid,
    sellerId,
  };

  const pay = await axios.post(
    `${PAYSTACK_BASE}/transaction/initialize`,
    { email, amount: amount * 100, metadata },
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
  );

  res.json({ url: pay.data.data.authorization_url });
});

// ================= PAYSTACK WEBHOOK =================
app.post(
  "/paystack/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET)
      .update(req.body)
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) return res.sendStatus(400);

    const event = JSON.parse(req.body);

    if (event.event === "charge.success") {
      const { metadata, amount } = event.data;
      const value = amount / 100;

      if (metadata.type === "wallet") {
        await db.collection("users").doc(metadata.uid).update({
          balance: admin.firestore.FieldValue.increment(value),
        });
      }

      if (metadata.type === "product") {
        const sellerShare = value * 0.9;
        await db.collection("users").doc(metadata.sellerId).update({
          balance: admin.firestore.FieldValue.increment(sellerShare),
        });
      }

      await db.collection("transactions").add({
        ...metadata,
        amount: value,
        status: "completed",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    res.sendStatus(200);
  }
);

// ================= WITHDRAW =================
app.post("/withdraw", auth, async (req, res) => {
  const { amount } = req.body;
  const ref = db.collection("users").doc(req.uid);
  const snap = await ref.get();

  if (snap.data().kycStatus !== "verified") {
    return res.status(403).json({ error: "KYC required" });
  }

  if (snap.data().balance < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  await ref.update({
    balance: admin.firestore.FieldValue.increment(-amount),
  });

  res.json({ success: true });
});

// ================= DISPUTES =================
app.post("/dispute/create", auth, async (req, res) => {
  const { transactionId, reason } = req.body;

  await db.collection("disputes").add({
    userId: req.uid,
    transactionId,
    reason,
    status: "open",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.json({ success: true });
});

// ================= REFUND =================
app.post("/admin/refund", async (req, res) => {
  const { transactionId } = req.body;
  const ref = db.collection("transactions").doc(transactionId);
  const snap = await ref.get();

  if (!snap.exists || snap.data().status === "refunded") {
    return res.status(400).json({ error: "Invalid transaction" });
  }

  await db.collection("users").doc(snap.data().uid).update({
    balance: admin.firestore.FieldValue.increment(-snap.data().amount),
  });

  await ref.update({ status: "refunded" });
  res.json({ success: true });
});

// ================= START =================
app.get("/", (_, res) => res.send("✅ True Ads Backend Live"));
app.listen(process.env.PORT || 3000, () =>
  console.log("🚀 Server running")
);
