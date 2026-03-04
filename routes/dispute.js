import express from "express";
import verifyToken from "./middleware-auth.js";
import { db } from "./firebase.js";

const router = express.Router();

/* ===============================
   OPEN DISPUTE
================================= */
router.post("/open", verifyToken, async (req, res) => {
  try {
    const { escrowId, reason } = req.body;
    const uid = req.user.uid;

    if (!escrowId || !reason) {
      return res.status(400).json({
        success: false,
        error: "Escrow ID and reason are required"
      });
    }

    const escrowRef = db.collection("ESCROWS").doc(escrowId);
    const escrowDoc = await escrowRef.get();

    if (!escrowDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Escrow not found"
      });
    }

    const escrow = escrowDoc.data();

    // Only buyer or seller can open dispute
    if (escrow.buyerId !== uid && escrow.sellerId !== uid) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to dispute this escrow"
      });
    }

    // Only allow dispute if funded
    if (escrow.status !== "FUNDED") {
      return res.status(400).json({
        success: false,
        error: "Escrow is not eligible for dispute"
      });
    }

    // 1️⃣ Create dispute record
    await db.collection("ESCROW_DISPUTES").add({
      escrowId,
      openedBy: uid,
      reason,
      status: "OPEN",
      createdAt: Date.now()
    });

    // 2️⃣ Update escrow status
    await escrowRef.update({
      status: "DISPUTED"
    });

    return res.json({
      success: true,
      message: "Dispute opened successfully"
    });

  } catch (err) {
    console.error("Open dispute error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to open dispute"
    });
  }
});

export default router;
