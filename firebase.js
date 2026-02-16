import admin from "firebase-admin";

const FIREBASE_B64 = process.env.FIREBASE_ADMIN_B64;

if (!FIREBASE_B64) {
  throw new Error("FIREBASE_ADMIN_B64 not found in environment");
}

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(FIREBASE_B64, "base64").toString("utf8")
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const ESCROW_DB = admin.firestore();
export const ESCROW_AUTH = admin.auth();
export const ESCROW_FIELD = admin.firestore.FieldValue;
