import express from "express";
import { db } from "../firebase.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

/* ================= GET MY PROFILE ================= */
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const doc = await db.collection("users").doc(req.user.uid).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "User profile not found"
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        uid: doc.id,
        ...doc.data()
      }
    });
  } catch (error) {
    console.error("GET /api/users/me error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile"
    });
  }
});

/* ================= CREATE OR UPDATE PROFILE ================= */
router.post("/profile", authenticateToken, async (req, res) => {
  try {
    const {
      fullName,
      phone,
      storeName,
      bio,
      location,
      sellerType,
      role
    } = req.body;

    const allowedRoles = ["buyer", "seller"];
    const allowedSellerTypes = [
      "",
      "Physical Products",
      "Digital Products",
      "Creative/Design",
      "Music/Audio",
      "Services"
    ];

    const safeRole = allowedRoles.includes(role) ? role : "buyer";
    const safeSellerType = allowedSellerTypes.includes(sellerType || "")
      ? (sellerType || "")
      : "";

    const payload = {
      uid: req.user.uid,
      email: req.user.email || "",
      fullName: fullName ? String(fullName).trim() : req.user.fullName || "",
      phone: phone ? String(phone).trim() : req.user.phone || "",
      storeName: storeName ? String(storeName).trim() : req.user.storeName || "",
      bio: bio ? String(bio).trim() : req.user.bio || "",
      location: location ? String(location).trim() : req.user.location || "",
      role: safeRole,
      sellerType: safeSellerType,
      banned: req.user.banned || false,
      updatedAt: new Date().toISOString()
    };

    const docRef = db.collection("users").doc(req.user.uid);
    const existing = await docRef.get();

    if (!existing.exists) {
      payload.createdAt = new Date().toISOString();
    }

    await docRef.set(payload, { merge: true });

    const updated = await docRef.get();

    return res.status(200).json({
      success: true,
      message: "Profile saved successfully",
      user: {
        uid: updated.id,
        ...updated.data()
      }
    });
  } catch (error) {
    console.error("POST /api/users/profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save profile"
    });
  }
});

/* ================= UPGRADE TO SELLER ================= */
router.post("/upgrade-seller", authenticateToken, async (req, res) => {
  try {
    const { sellerType, storeName } = req.body;

    const allowedSellerTypes = [
      "Physical Products",
      "Digital Products",
      "Creative/Design",
      "Music/Audio",
      "Services"
    ];

    if (!sellerType || !allowedSellerTypes.includes(sellerType)) {
      return res.status(400).json({
        success: false,
        message: "Valid sellerType is required"
      });
    }

    const docRef = db.collection("users").doc(req.user.uid);

    await docRef.set({
      uid: req.user.uid,
      email: req.user.email || "",
      fullName: req.user.fullName || "",
      phone: req.user.phone || "",
      bio: req.user.bio || "",
      location: req.user.location || "",
      storeName: storeName ? String(storeName).trim() : req.user.storeName || "",
      role: "seller",
      sellerType,
      banned: req.user.banned || false,
      updatedAt: new Date().toISOString(),
      createdAt: req.user.createdAt || new Date().toISOString()
    }, { merge: true });

    const updated = await docRef.get();

    return res.status(200).json({
      success: true,
      message: "Seller upgrade successful",
      user: {
        uid: updated.id,
        ...updated.data()
      }
    });
  } catch (error) {
    console.error("POST /api/users/upgrade-seller error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upgrade seller"
    });
  }
});

export default router;
