import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

/* ================= GET ALL PRODUCTS ================= */
router.get("/", async (req, res) => {
  try {
    const snapshot = await db
      .collection("products")
      .orderBy("createdAt", "desc")
      .get();

    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;

    const products = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => {
        // Keep active products
        if (p.status !== "SOLD") return true;

        // Keep SOLD products if soldAt < 3 days ago
        if (p.soldAt && now - new Date(p.soldAt).getTime() <= threeDays) {
          return true;
        }

        // Otherwise ignore (delete in background)
        return false;
      });

    res.json(products);

    // 🔹 background deletion of old SOLD products
    snapshot.docs.forEach(async (doc) => {
      const data = doc.data();
      if (
        data.status === "SOLD" &&
        data.soldAt &&
        now - new Date(data.soldAt).getTime() > threeDays
      ) {
        try {
          await db.collection("products").doc(doc.id).delete();
        } catch (e) {
          console.error("Failed to delete old product", doc.id, e);
        }
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

/* ================= ADD PRODUCT ================= */
router.post("/add", async (req, res) => {
  try {
    const { name, price, description, imageUrl, sellerUid, sellerName, category } = req.body;

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
      category: category || "",
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      soldAt: null
    };

    const docRef = await db.collection("products").add(newProduct);

    res.json({ message: "Product added successfully", id: docRef.id });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add product" });
  }
});

/* ================= MARK PRODUCT SOLD ================= */
router.post("/:id/sold", async (req, res) => {
  try {
    await db.collection("products").doc(req.params.id).update({
      status: "SOLD",
      soldAt: new Date().toISOString()
    });
    res.json({ message: "Product marked as SOLD" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update product" });
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
