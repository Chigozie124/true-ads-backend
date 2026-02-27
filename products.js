import express from "express";
import { db } from "./firebase.js";
import verifyToken from "./middleware-auth.js";

const router = express.Router();

/* GET all products */
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

/* POST add product (requires token + seller) */
router.post("/add", verifyToken, async (req, res) => {
  try {
    const { name, price, description, imageUrl } = req.body;
    const uid = req.user.uid;

    // You can also fetch user role from Firestore
    const userDoc = await db.collection("users").doc(uid).get();
    const user = userDoc.data();
    if (!user || !user.isSeller) return res.status(403).json({ error: "Only sellers can add products" });

    const productRef = await db.collection("products").add({
      name,
      price,
      description,
      imageUrl,
      sellerId: uid,
      createdAt: Date.now(),
      status: "available"
    });

    res.json({ message: "Product added", id: productRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add product" });
  }
});

export default router;
