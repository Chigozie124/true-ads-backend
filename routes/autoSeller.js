import { db, admin } from "./firebase.js";

console.log("Auto-seller service running...");

// Listen to all changes in the users collection
db.collection("users").onSnapshot((snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    const userDoc = change.doc;
    const data = userDoc.data();
    const updates = {};

    // 1️⃣ Remove deprecated 'seller' field if it exists
    if ("seller" in data) updates.seller = admin.firestore.FieldValue.delete();

    // 2️⃣ Automatically set isseller = true for verified users who don't have it yet
    if (data.verified && !("isseller" in data)) updates.isseller = true;

    // Only update if needed
    if (Object.keys(updates).length > 0) {
      try {
        await db.collection("users").doc(userDoc.id).update(updates);
        console.log(`✅ Updated user ${userDoc.id}:`, updates);
      } catch (err) {
        console.error(`❌ Failed to update user ${userDoc.id}:`, err);
      }
    }
  });
});
