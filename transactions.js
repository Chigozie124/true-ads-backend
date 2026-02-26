import express from "express";
import { ESCROW_DB } from "./firebase.js";
import verifyToken from "./middleware-auth.js";

const router = express.Router();

/* ===== GET USER TRANSACTIONS ===== */
router.get("/", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snapshot = await ESCROW_DB.collection("TRANSACTIONS")
      .where("userId", "==", uid)
      .orderBy("createdAt", "desc")
      .get();

    const transactions = snapshot.docs.map(doc => doc.data());
    res.json({ transactions });
  } catch (err) {
    console.error("Transactions error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
