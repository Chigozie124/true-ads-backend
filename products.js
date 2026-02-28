import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

/* ================= GET ALL PRODUCTS ================= */
router.get("/", async (req, res) => {
  try {
    const snapshot = await db.collection("products").get();

    const products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

/* ================= ADD PRODUCT ================= */
router.post("/add", async (req, res) => {
  try {
    const {
      name,
      price,
      description,
      imageUrl,
      sellerUid,
      sellerName
    } = req.body;

    if (!name || !price || !sellerUid) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newProduct = {
      name,
      price: Number(price),
      description: description || "",
      imageUrl: imageUrl || "",
      sellerUid,
      sellerName: sellerName || "",
      status: "ACTIVE",
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection("products").add(newProduct);

    res.json({
      message: "Product added successfully",
      id: docRef.id
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add product" });
  }
});

/* ================= DELETE PRODUCT ================= */
router.delete("/:id/delete", async (req, res) => {
  try {
    await db.collection("products").doc(req.params.id).delete();
    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete product" });
  }
});

export default router;
