import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const snap = await db.collection("products").get();
  const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(products);
});

export default router;
