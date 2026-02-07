import { db } from "./firebase.js";

export async function autoReleaseEscrow() {
  const snap = await db.collection("orders")
    .where("status", "==", "escrow")
    .get();

  for (const doc of snap.docs) {
    const o = doc.data();
    if (Date.now() - o.createdAt > 3 * 24 * 60 * 60 * 1000) {
      await doc.ref.update({ status: "released" });
    }
  }
}
