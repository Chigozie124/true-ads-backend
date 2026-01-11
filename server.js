import express from "express";
import cors from "cors";
import crypto from "crypto";
import admin from "firebase-admin";
import fetch from "node-fetch";

/* ------------------ INITIALIZE APP ------------------ */
const app = express();
app.use(cors());
app.use(express.json({ verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true }));

function rawBodySaver(req, res, buf) {
  req.rawBody = buf;
}

/* ------------------ FIREBASE ADMIN ------------------ */
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  })
});

const db = admin.firestore();

/* ------------------ HELPERS ------------------ */
const notify = async (uid, title, message) => {
  await db.collection("notifications").add({
    uid,
    title,
    message,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
};

const calculateRating = async (uid) => {
  const snaps = await db.collection("ratings").where("targetUid", "==", uid).get();
  if (snaps.empty) return 100;

  let total = 0;
  snaps.forEach(d => total += d.data().score);
  return Math.round(total / snaps.size);
};

/* ------------------ AUTH SYNC ------------------ */
app.post("/auth/sync", async (req, res) => {
  const { uid, name, email } = req.body;

  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      uid,
      name,
      email,
      balance: 0,
      role: "user",
      banned: false,
      rating: 100,
      verified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  res.json({ success: true });
});

/* ------------------ BAN CHECK (HOME PAGE) ------------------ */
app.get("/user/status/:uid", async (req, res) => {
  const doc = await db.collection("users").doc(req.params.uid).get();
  if (!doc.exists) return res.status(404).json({ error: "User not found" });

  const user = doc.data();
  if (user.banned) return res.json({ banned: true });

  res.json({ banned: false, verified: user.verified, rating: user.rating });
});

/* ------------------ PAYSTACK INITIALIZE ------------------ */
app.post("/payment/init", async (req, res) => {
  const { email, amount, type, uid } = req.body;

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      amount: amount * 100,
      metadata: { uid, type }
    })
  });

  const data = await response.json();
  res.json(data);
});

/* ------------------ PAYSTACK WEBHOOK ------------------ */
app.post("/paystack/webhook", async (req, res) => {
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    return res.sendStatus(401);
  }

  const event = req.body;

  if (event.event === "charge.success") {
    const { uid, type } = event.data.metadata;
    const amount = event.data.amount / 100;

    if (type === "order") {
      await db.collection("orders").add({
        uid,
        amount,
        status: "paid",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await notify(uid, "Payment Successful", "Your order was paid successfully");
    }

    if (type === "verify") {
      await db.collection("users").doc(uid).update({ verified: true });
      await notify(uid, "Verified", "Your account is now verified ✅");
    }
  }

  res.sendStatus(200);
});

/* ------------------ WITHDRAWAL ------------------ */
app.post("/withdraw", async (req, res) => {
  const { uid, amount } = req.body;
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) return res.status(404).json({ error: "User not found" });
  if (snap.data().balance < amount) return res.status(400).json({ error: "Insufficient balance" });

  await ref.update({
    balance: admin.firestore.FieldValue.increment(-amount)
  });

  await db.collection("withdrawals").add({
    uid,
    amount,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await notify(uid, "Withdrawal Requested", "Your withdrawal is being processed");
  res.json({ success: true });
});

/* ------------------ RATING SYSTEM ------------------ */
app.post("/rate", async (req, res) => {
  const { fromUid, targetUid, score } = req.body;

  await db.collection("ratings").add({
    fromUid,
    targetUid,
    score,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const rating = await calculateRating(targetUid);

  const update = { rating };
  if (rating <= 0) update.banned = true;

  await db.collection("users").doc(targetUid).update(update);

  if (rating === 100) {
    await notify(targetUid, "Eligible for Verification", "You can now apply for verification");
  }

  res.json({ success: true, rating });
});

/* ------------------ DISPUTES ------------------ */
app.post("/dispute", async (req, res) => {
  const { uid, orderId, reason } = req.body;

  await db.collection("disputes").add({
    uid,
    orderId,
    reason,
    status: "open",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await notify(uid, "Dispute Opened", "Your dispute is under review");
  res.json({ success: true });
});

/* ------------------ ADMIN ACTIONS ------------------ */
app.post("/admin/ban", async (req, res) => {
  const { uid } = req.body;
  await db.collection("users").doc(uid).update({ banned: true });
  await notify(uid, "Account Banned", "Your account has been banned");
  res.json({ success: true });
});

app.post("/admin/unban", async (req, res) => {
  const { uid } = req.body;
  await db.collection("users").doc(uid).update({ banned: false });
  res.json({ success: true });
});

/* ------------------ SERVER ------------------ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on ${PORT}`));
