import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

/* Get Products */
router.get("/", async (req, res, next) => {
  try {

    const snapshot = await db.collection("products").get();

    const products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(products);

  } catch (err) {
    next(err);
  }
});

export default router;
