import express from "express";
import { ESCROW_DB, ESCROW_AUTH } from "./firebase.js";
import verifyToken from "./middleware-auth.js";

const router = express.Router();

/* ===== CHECK ADMIN ROLE ===== */
async function checkAdmin(req, res, next) {
  const uid = req.user.uid;
  const userRecord = await ESCROW_AUTH.getUser(uid);
  if (!userRecord.customClaims?.admin) {
    return res.status(403).json({ error: "Access denied" });
  }
  next();
}

/* ===== GET SITE ANALYTICS ===== */
router.get("/analytics", verifyToken, checkAdmin, async (req, res) => {
  try {
    const usersSnapshot = await ESCROW_DB.collection("USERS").get();
    const walletsSnapshot = await ESCROW_DB.collection("WALLETS").get();
    const escrowsSnapshot = await ESCROW_DB.collection("ESCROWS").get();

    res.json({
      totalUsers: usersSnapshot.size,
      totalWalletBalance: walletsSnapshot.docs.reduce((sum, d) => sum + (d.data().balance || 0), 0),
      totalEscrows: escrowsSnapshot.size,
    });
  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ===== BAN/UNBAN USER ===== */
router.post("/ban", verifyToken, checkAdmin, async (req, res) => {
  try {
    const { uid, ban } = req.body; // ban: true/false
    await ESCROW_AUTH.setCustomUserClaims(uid, { banned: ban });
    res.json({ message: `User ${ban ? "banned" : "unbanned"}` });
  } catch (err) {
    console.error("Ban user error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
