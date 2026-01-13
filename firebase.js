import admin from "firebase-admin";

if (!process.env.FIREBASE_ADMIN_JSON) {
  throw new Error("FIREBASE_ADMIN_JSON env variable is not set");
}

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export const db = admin.firestore();
export { admin };
