import { db } from "./firebaseAdmin.js";

export default async function ensureUser(uid, email) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      email,
      balance: 0,
      createdAt: Date.now(),
    });
  }
}
