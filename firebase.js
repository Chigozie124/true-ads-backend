import admin from "firebase-admin";
import fs from "fs";
import path from "path";

// Determine which file to use
let serviceAccount;

// Check if Render secret exists
if (fs.existsSync("/etc/secrets/firebase-admin.json")) {
  serviceAccount = JSON.parse(fs.readFileSync("/etc/secrets/firebase-admin.json", "utf8"));
} else {
  // Fallback to local file for Termux / development
  const localPath = path.join(process.cwd(), "firebase-admin.json");
  if (!fs.existsSync(localPath)) {
    throw new Error("Firebase admin JSON not found locally. Place it as firebase-admin.json in your project root.");
  }
  serviceAccount = JSON.parse(fs.readFileSync(localPath, "utf8"));
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export const db = admin.firestore();
export { admin };
