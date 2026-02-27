import express from "express";
import { db } from "./firebase.js";
import verifyToken from "./middleware-auth.js";

const router = express.Router();

/* ===============================
   GET USER TRANSACTIONS
================================= */
router.get("/", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snapshot = await db
      .collection("TRANSACTIONS")
      .where("userId", "==", uid)
      .orderBy("createdAt", "desc")
      .get();

    const transactions = snapshot.docs.map(doc => doc.data());

    return res.json({
      success: true,
      transactions
    });
  } catch (err) {
    console.error("Transactions error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch transactions"
    });
  }
});

export default router;
