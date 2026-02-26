import express from "express";
import { ESCROW_DB, ESCROW_FIELD } from "./firebase.js";
import verifyToken from "./middleware-auth.js";

const router = express.Router();

/* ===== CREATE ESCROW ===== */
router.post("/create", verifyToken, async (req, res) => {
  try {
    const { amount, sellerId, title } = req.body;
    const uid = req.user.uid;

    const escrowRef = ESCROW_DB.collection("ESCROWS").doc();
    await escrowRef.set({
      id: escrowRef.id,
      buyerId: uid,
      sellerId,
      amount,
      title,
      status: "PENDING",
      createdAt: Date.now(),
    });

    res.json({ message: "Escrow created", escrowId: escrowRef.id });
  } catch (err) {
    console.error("Create escrow error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ===== GET USER ESCROWS ===== */
router.get("/", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snapshot = await ESCROW_DB.collection("ESCROWS")
      .where("buyerId", "==", uid)
      .get();

    const escrows = snapshot.docs.map(doc => doc.data());
    res.json({ escrows });
  } catch (err) {
    console.error("Get escrows error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
