import express from "express";
import { db, auth } from "./firebase.js";
import verifyToken from "./middleware-auth.js";

const router = express.Router();

/* ===============================
   CHECK ADMIN ROLE
================================= */
async function checkAdmin(req, res, next) {
  try {
    const uid = req.user.uid;

    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const userData = userDoc.data();

    if (userData.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Admin access required"
      });
    }

    next();
  } catch (err) {
    console.error("Admin check error:", err);
    return res.status(500).json({
      success: false,
      error: "Admin verification failed"
    });
  }
}

/* ===============================
   GET SITE ANALYTICS
================================= */
router.get("/analytics", verifyToken, checkAdmin, async (req, res) => {
  try {
    const usersSnapshot = await db.collection("users").get();
    const walletsSnapshot = await db.collection("ESCROW_USER").get();
    const escrowsSnapshot = await db.collection("ESCROWS").get();

    const totalWalletBalance = walletsSnapshot.docs.reduce(
      (sum, doc) => sum + (doc.data().balance || 0),
      0
    );

    return res.json({
      success: true,
      totalUsers: usersSnapshot.size,
      totalWalletBalance,
      totalEscrows: escrowsSnapshot.size,
    });

  } catch (err) {
    console.error("Analytics error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to load analytics"
    });
  }
});

/* ===============================
   BAN / UNBAN USER
================================= */
router.post("/ban", verifyToken, checkAdmin, async (req, res) => {
  try {
    const { uid, ban } = req.body;

    if (!uid || typeof ban !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "uid and ban (true/false) required"
      });
    }

    await db.collection("users").doc(uid).update({
      banned: ban
    });

    return res.json({
      success: true,
      message: `User ${ban ? "banned" : "unbanned"} successfully`
    });

  } catch (err) {
    console.error("Ban user error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to update user"
    });
  }
});

export default router;
