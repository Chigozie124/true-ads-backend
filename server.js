// server.js
import admin from "firebase-admin";
import { dirname } from "path";
import { fileURLToPath } from "url";

// Needed to resolve __dirname in ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the admin SDK JSON
const serviceAccount = await import(`file://${__dirname}/firebase-admin.json`, {
  assert: { type: "json" }
});

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount.default)
});

const db = admin.firestore();

console.log("✅ Firebase Admin initialized!");

// Example: list all users in "users" collection
async function listUsers() {
  const snapshot = await db.collection("users").get();
  snapshot.forEach(doc => {
    console.log(doc.id, doc.data());
  });
}

listUsers();
