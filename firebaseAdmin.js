import admin from "firebase-admin";

if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_ADMIN_B64
    ? JSON.parse(
        Buffer.from(process.env.FIREBASE_ADMIN_B64, "base64").toString("utf8")
      )
    : JSON.parse(require("fs").readFileSync("./serviceAccount.json"));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const db = admin.firestore();
export const auth = admin.auth();
