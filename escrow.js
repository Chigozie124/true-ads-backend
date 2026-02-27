import express from "express";
import { db, FieldValue } from "./firebase.js";
import verifyToken from "./middleware-auth.js";

const router = express.Router();

/* ===============================
   CREATE ESCROW
================================= */
router.post("/create", verifyToken, async (req, res) => {
  try {
    const { amount, sellerId, title } = req.body;
    const buyerId = req.user.uid;

    if (!amount || !sellerId || !title) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields"
      });
    }

    const escrowRef = db.collection("ESCROWS").doc();

    await escrowRef.set({
      id: escrowRef.id,
      buyerId,
      sellerId,
      amount: Number(amount),
      title,
      status: "PENDING",
      createdAt: Date.now(),
      fundedAt: null,
      releasedAt: null
    });

    return res.json({
      success: true,
      message: "Escrow created successfully",
      escrowId: escrowRef.id
    });

  } catch (err) {
    console.error("Create escrow error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to create escrow"
    });
  }
});

/* ===============================
   GET USER ESCROWS
================================= */
router.get("/", verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snapshot = await db
      .collection("ESCROWS")
      .where("buyerId", "==", uid)
      .get();

    const escrows = snapshot.docs.map(doc => doc.data());

    return res.json({
      success: true,
      escrows
    });

  } catch (err) {
    console.error("Get escrows error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch escrows"
    });
  }
});

/* ===============================
   RELEASE ESCROW (MANUAL)
================================= */
router.post("/release/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const uid = req.user.uid;

    const escrowRef = db.collection("ESCROWS").doc(id);
    const escrowDoc = await escrowRef.get();

    if (!escrowDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Escrow not found"
      });
    }

    const escrow = escrowDoc.data();

    if (escrow.buyerId !== uid) {
      return res.status(403).json({
        success: false,
        error: "Not authorized"
      });
    }

    if (escrow.status !== "FUNDED") {
      return res.status(400).json({
        success: false,
        error: "Escrow not funded"
      });
    }

    // 1️⃣ Update escrow
    await escrowRef.update({
      status: "RELEASED",
      releasedAt: Date.now()
    });

    // 2️⃣ Credit seller
    await db.collection("ESCROW_USER")
      .doc(escrow.sellerId)
      .update({
        balance: FieldValue.increment(escrow.amount)
      });

    return res.json({
      success: true,
      message: "Escrow released successfully"
    });

  } catch (err) {
    console.error("Release escrow error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to release escrow"
    });
  }
});

export default router;
