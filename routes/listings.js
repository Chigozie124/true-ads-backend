import express from "express";
import { db, FieldValue } from "../firebase.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

/* ================= GET ALL LISTINGS ================= */
router.get("/", async (req, res) => {
  try {
    const snapshot = await db
      .collection("listings")
      .orderBy("createdAt", "desc")
      .get();

    const listings = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json({
      success: true,
      count: listings.length,
      listings
    });
  } catch (error) {
    console.error("GET /api/listings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch listings"
    });
  }
});

/* ================= GET SINGLE LISTING ================= */
router.get("/:id", async (req, res) => {
  try {
    const doc = await db.collection("listings").doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "Listing not found"
      });
    }

    return res.status(200).json({
      success: true,
      listing: {
        id: doc.id,
        ...doc.data()
      }
    });
  } catch (error) {
    console.error("GET /api/listings/:id error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch listing"
    });
  }
});

/* ================= GET MY LISTINGS ================= */
router.get("/seller/me", authenticateToken, async (req, res) => {
  try {
    const snapshot = await db
      .collection("listings")
      .where("sellerUid", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .get();

    const listings = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json({
      success: true,
      count: listings.length,
      listings
    });
  } catch (error) {
    console.error("GET /api/listings/seller/me error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch seller listings"
    });
  }
});

/* ================= CREATE LISTING ================= */
router.post("/", authenticateToken, async (req, res) => {
  try {
    const {
      title,
      price,
      description,
      imageUrl,
      category,
      sellerType,
      listingType,
      fileUrl,
      streamUrl,
      serviceMode
    } = req.body;

    if (!title || !price || !sellerType) {
      return res.status(400).json({
        success: false,
        message: "title, price and sellerType are required"
      });
    }

    const allowedSellerTypes = [
      "Physical Products",
      "Digital Products",
      "Creative/Design",
      "Music/Audio",
      "Services"
    ];

    if (!allowedSellerTypes.includes(sellerType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sellerType"
      });
    }

    const newListing = {
      title: String(title).trim(),
      price: Number(price),
      description: description ? String(description).trim() : "",
      imageUrl: imageUrl ? String(imageUrl).trim() : "",
      category: category ? String(category).trim() : "",
      sellerType,
      listingType: listingType ? String(listingType).trim() : "",
      fileUrl: fileUrl ? String(fileUrl).trim() : "",
      streamUrl: streamUrl ? String(streamUrl).trim() : "",
      serviceMode: serviceMode ? String(serviceMode).trim() : "",
      status: "ACTIVE",
      featured: false,
      sellerUid: req.user.uid,
      sellerName: req.user.storeName || req.user.fullName || req.user.email || "True Ads Seller",
      sellerEmail: req.user.email || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      views: 0,
      saves: 0
    };

    const docRef = await db.collection("listings").add(newListing);

    return res.status(201).json({
      success: true,
      message: "Listing created successfully",
      id: docRef.id,
      listing: {
        id: docRef.id,
        ...newListing
      }
    });
  } catch (error) {
    console.error("POST /api/listings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create listing"
    });
  }
});

/* ================= UPDATE LISTING ================= */
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const docRef = db.collection("listings").doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "Listing not found"
      });
    }

    const existing = doc.data();

    if (existing.sellerUid !== req.user.uid && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to update this listing"
      });
    }

    const updates = {};
    const fields = [
      "title",
      "price",
      "description",
      "imageUrl",
      "category",
      "sellerType",
      "listingType",
      "fileUrl",
      "streamUrl",
      "serviceMode",
      "status",
      "featured"
    ];

    fields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (updates.price !== undefined) {
      updates.price = Number(updates.price);
    }

    updates.updatedAt = new Date().toISOString();

    await docRef.update(updates);

    const updatedDoc = await docRef.get();

    return res.status(200).json({
      success: true,
      message: "Listing updated successfully",
      listing: {
        id: updatedDoc.id,
        ...updatedDoc.data()
      }
    });
  } catch (error) {
    console.error("PUT /api/listings/:id error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update listing"
    });
  }
});

/* ================= DELETE LISTING ================= */
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const docRef = db.collection("listings").doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "Listing not found"
      });
    }

    const existing = doc.data();

    if (existing.sellerUid !== req.user.uid && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to delete this listing"
      });
    }

    await docRef.delete();

    return res.status(200).json({
      success: true,
      message: "Listing deleted successfully"
    });
  } catch (error) {
    console.error("DELETE /api/listings/:id error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete listing"
    });
  }
});

/* ================= MARK SOLD ================= */
router.patch("/:id/sold", authenticateToken, async (req, res) => {
  try {
    const docRef = db.collection("listings").doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "Listing not found"
      });
    }

    const existing = doc.data();

    if (existing.sellerUid !== req.user.uid && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to mark this listing as sold"
      });
    }

    await docRef.update({
      status: "SOLD",
      soldAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: "Listing marked as sold"
    });
  } catch (error) {
    console.error("PATCH /api/listings/:id/sold error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update listing"
    });
  }
});

export default router;
