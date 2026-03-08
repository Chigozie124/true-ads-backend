import { db, FieldValue } from "../firebase.js";

function generatePublicId() {
  return `UID${Math.floor(100000 + Math.random() * 900000)}`;
}

export default async function ensureUserData(uid, email = "", fullName = "") {
  const userRef = db.collection("users").doc(uid);
  const walletRef = db.collection("wallets").doc(uid);

  const [userSnap, walletSnap] = await Promise.all([
    userRef.get(),
    walletRef.get()
  ]);

  if (!userSnap.exists) {
    await userRef.set({
      email: email || "",
      fullName: fullName || "",
      role: "user",
      banned: false,
      publicId: generatePublicId(),
      createdAt: FieldValue.serverTimestamp(),
      lastLogin: FieldValue.serverTimestamp()
    }, { merge: true });
  } else {
    const userData = userSnap.data() || {};
    const updates = {};

    if (!userData.email && email) updates.email = email;
    if (!userData.fullName && fullName) updates.fullName = fullName;
    if (!userData.role) updates.role = "user";
    if (typeof userData.banned === "undefined") updates.banned = false;
    if (!userData.publicId) updates.publicId = generatePublicId();
    updates.lastLogin = FieldValue.serverTimestamp();

    if (Object.keys(updates).length) {
      await userRef.set(updates, { merge: true });
    }
  }

  if (!walletSnap.exists) {
    await walletRef.set({
      userId: uid,
      balance: 0,
      escrowed: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      totalEarned: 0,
      totalSpent: 0,
      currency: "NGN",
      status: "active",
      transactionCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  } else {
    const walletData = walletSnap.data() || {};
    const walletUpdates = {};

    if (typeof walletData.balance === "undefined") walletUpdates.balance = 0;
    if (typeof walletData.escrowed === "undefined") walletUpdates.escrowed = 0;
    if (typeof walletData.totalDeposited === "undefined") walletUpdates.totalDeposited = 0;
    if (typeof walletData.totalWithdrawn === "undefined") walletUpdates.totalWithdrawn = 0;
    if (typeof walletData.totalEarned === "undefined") walletUpdates.totalEarned = 0;
    if (typeof walletData.totalSpent === "undefined") walletUpdates.totalSpent = 0;
    if (!walletData.currency) walletUpdates.currency = "NGN";
    if (!walletData.status) walletUpdates.status = "active";
    if (typeof walletData.transactionCount === "undefined") walletUpdates.transactionCount = 0;
    walletUpdates.updatedAt = FieldValue.serverTimestamp();

    if (Object.keys(walletUpdates).length) {
      await walletRef.set(walletUpdates, { merge: true });
    }
  }

  return { success: true };
}
