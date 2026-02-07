import { db } from "../config/firebaseAdmin.js";

export async function ensureUserData(uid, data) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      role: "buyer",
      banned: false,
      balance: 0,
      sellerApproved: false,
      createdAt: Date.now(),
      ...data,
    });
  }
}
