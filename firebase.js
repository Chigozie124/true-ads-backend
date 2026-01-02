import admin from "firebase-admin";
import fs from "fs";

let serviceAccount;

// ✅ Works on Render (secret file)
if (process.env.RENDER === "true") {
  serviceAccount = JSON.parse(
    fs.readFileSync("/etc/secrets/firebase-admin.json", "utf8")
  );
} else {
  // ✅ Works locally in Termux
  serviceAccount = JSON.parse(
    fs.readFileSync("./firebase-admin.json", "utf8")
  );
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

export { admin, db };
