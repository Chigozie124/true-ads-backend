import admin from "firebase-admin";

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

/* ===== EXPORTS ===== */

export const db = admin.firestore();
export const auth = admin.auth();
export const FieldValue = admin.firestore.FieldValue;

export default admin;
