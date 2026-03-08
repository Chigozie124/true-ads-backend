import express from "express";
import { db, auth } from "../firebase.js";
import verifyToken from "../middleware/auth.js";
import ensureUserData from "./ensureUserData.js";

const router = express.Router();

function generatePublicId() {
  return `UID${Math.floor(100000 + Math.random() * 900000)}`;
}

router.post("/signup", async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: "All fields are required"
      });
    }

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: fullName
    });

    await db.collection("users").doc(userRecord.uid).set({
      email,
      fullName,
      role: "user",
      banned: false,
      publicId: generatePublicId(),
      createdAt: Date.now(),
      lastLogin: Date.now()
    }, { merge: true });

    await ensureUserData(userRecord.uid, email, fullName);

    return res.json({
      success: true,
      uid: userRecord.uid,
      email,
      fullName
    });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

router.post("/login", async (req, res) => {
  return res.json({
    success: true,
    message: "Login handled on frontend using Firebase SDK"
  });
});

router.get("/profile", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const email = req.user.email || "";

    let fullName = "";

    try {
      const authUser = await auth.getUser(uid);
      fullName = authUser.displayName || "";
    } catch (e) {
      console.log("Could not fetch auth displayName:", e.message);
    }

    await ensureUserData(uid, email, fullName);

    const doc = await db.collection("users").doc(uid).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const user = doc.data();

    return res.json({
      success: true,
      uid,
      ...user
    });
  } catch (err) {
    console.error("Profile error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch profile"
    });
  }
});

router.post("/ensure", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const email = req.user.email || "";

    let fullName = "";

    try {
      const authUser = await auth.getUser(uid);
      fullName = authUser.displayName || "";
    } catch (e) {
      console.log("Could not fetch auth displayName:", e.message);
    }

    await ensureUserData(uid, email, fullName);

    const [userDoc, walletDoc] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("wallets").doc(uid).get()
    ]);

    return res.json({
      success: true,
      user: userDoc.exists ? userDoc.data() : null,
      wallet: walletDoc.exists ? walletDoc.data() : null
    });
  } catch (err) {
    console.error("Ensure user data error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to ensure user data"
    });
  }
});

export default router;
