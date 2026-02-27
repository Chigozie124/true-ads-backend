import express from "express";
import { db, auth } from "./firebase.js";
import verifyToken from "./middleware-auth.js";
import ensureUserData from "./ensureUserData.js";

const router = express.Router();

/* ===============================
   SIGNUP
================================= */
router.post("/signup", async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: "All fields are required"
      });
    }

    // 1️⃣ Create Firebase Auth user
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: fullName,
    });

    // 2️⃣ Create Firestore user profile
    await db.collection("users").doc(userRecord.uid).set({
      email,
      fullName,
      role: "user",
      banned: false,
      createdAt: Date.now()
    });

    // 3️⃣ Auto-create wallet
    await ensureUserData(userRecord.uid);

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

/* ===============================
   LOGIN
================================= */
router.post("/login", async (req, res) => {
  // Login handled via Firebase client SDK on frontend
  return res.json({
    success: true,
    message: "Login handled on frontend using Firebase SDK"
  });
});

/* ===============================
   GET USER PROFILE
================================= */
router.get("/profile", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

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

export default router;
