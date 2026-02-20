import admin from "firebase-admin";

console.log("FIREBASE_ADMIN_B64 length:", process.env.FIREBASE_ADMIN_B64?.length);

if (!admin.apps.length) {
  if (!process.env.FIREBASE_ADMIN_B64) {
    throw new Error("FIREBASE_ADMIN_B64 env variable is missing");
  }

  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_ADMIN_B64, "base64").toString("utf-8")
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const ESCROW_DB = admin.firestore();
export const ESCROW_AUTH = admin.auth();
export const ESCROW_FIELD = admin.firestore.FieldValue;
