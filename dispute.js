import express from "express";
import ESCROW_AUTH_MIDDLEWARE from "./auth.js";
import { ESCROW_DB } from "./firebase.js";

const router = express.Router();

router.post("/open", ESCROW_AUTH_MIDDLEWARE, async (req, res) => {
  const { escrowId, reason } = req.body;

  await ESCROW_DB.collection("ESCROW_DISPUTE").add({
    escrowId,
    openedBy: req.ESCROW_USER.uid,
    reason,
    status: "OPEN",
    createdAt: Date.now()
  });

  await ESCROW_DB.collection("ESCROW")
    .doc(escrowId)
    .update({ status: "DISPUTED" });

  res.json({ success: true });
});

export default router;
