import express from "express";
import { ESCROW_DB, ESCROW_FIELD } from "./firebase.js";
import verifyToken from "./middleware-auth.js";
import ensureUserData from "./ensureUserData.js";

const router = express.Router();

/* ===== GET WALLET BALANCE ===== */
router.get("/", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    await ensureUserData(uid);

    const doc = await ESCROW_DB.collection("WALLETS").doc(uid).get();
    const wallet = doc.data();
    res.json({ balance: wallet.balance || 0 });
  } catch (err) {
    console.error("Wallet error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ===== ADD FUNDS ===== */
router.post("/add", verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const uid = req.user.uid;

    await ESCROW_DB.collection("WALLETS").doc(uid).update({
      balance: ESCROW_FIELD.increment(amount)
    });

    res.json({ message: "Funds added successfully" });
  } catch (err) {
    console.error("Add funds error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
