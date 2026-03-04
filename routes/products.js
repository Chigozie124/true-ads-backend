import express from "express";
import { db } from "./firebase.js";
import verifyToken from "./middleware-auth.js";

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
        if (p.status !== "SOLD") return true;
        if (p.soldAt && now - new Date(p.soldAt).getTime() <= threeDays) return true;
        return false;
      });

    res.json(products);

    // background cleanup
    snapshot.docs.forEach(async (doc) => {
      const data = doc.data();
      if (
        data.status === "SOLD" &&
        data.soldAt &&
        now - new Date(data.soldAt).getTime() > threeDays
      ) {
        await db.collection("products").doc(doc.id).delete();
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

/* ================= ADD PRODUCT (PROTECTED) ================= */
router.post("/add", verifyToken, async (req, res) => {
  try {
    const { name, price, description, imageUrl, category } = req.body;

    if (!name || !price) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newProduct = {
      name,
      price: Number(price),
      description: description || "",
      imageUrl: imageUrl || "",
      category: category || "",
      sellerUid: req.user.uid, // from token
      sellerName: req.user.email,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      soldAt: null
    };

    const docRef = await db.collection("products").add(newProduct);

    res.json({ message: "Product added", id: docRef.id });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add product" });
  }
});

/* ================= MARK SOLD ================= */
router.post("/:id/sold", verifyToken, async (req, res) => {
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

/* ================= DELETE ================= */
router.delete("/:id/delete", verifyToken, async (req, res) => {
  try {
    await db.collection("products").doc(req.params.id).delete();
    res.json({ message: "Product deleted" });

  } catch (error) {
    res.status(500).json({ error: "Failed to delete product" });
  }
});

export default router;
