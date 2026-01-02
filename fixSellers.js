import { db, admin } from "./firebase.js";

async function cleanupSellers() {
  const snapshot = await db.collection("users").get();
  console.log(`Found ${snapshot.size} users. Checking seller fields...`);
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};
    if ("seller" in data) updates.seller = admin.firestore.FieldValue.delete();
    if ("isseller" in data && data.isseller === false) updates.isseller = false;
    if (Object.keys(updates).length) {
      await doc.ref.update(updates);
      console.log(`Removed seller/isseller for user ${doc.id}`);
    }
  }
  console.log("🎉 All users cleaned up!");
}

cleanupSellers();
