import express from "express";
import { db } from "./firebase.js";
import verifyToken from "./middleware-auth.js";

const router = express.Router();

/* GET all notifications for a user */
router.get("/:uid", verifyToken, async (req, res) => {
  const { uid } = req.params;

  // Ensure user can only fetch their own notifications
  if (req.user.uid !== uid) return res.status(403).json({ error: "Forbidden" });

  try {
    const snapshot = await db.collection("users")
      .doc(uid)
      .collection("notifications")
      .orderBy("createdAt", "desc")
      .get();

    const notifications = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(notifications);

  } catch (err) {
    console.error("Notifications fetch error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

/* POST – add a new notification (admin or system) */
router.post("/:uid", verifyToken, async (req, res) => {
  const { uid } = req.params;
  const { message } = req.body;

  // Only allow admin or system roles to add notifications
  if (!["admin", "subadmin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const docRef = await db.collection("users")
      .doc(uid)
      .collection("notifications")
      .add({
        message,
        read: false,
        createdAt: new Date()
      });

    res.json({ id: docRef.id, message: "Notification sent" });
  } catch (err) {
    console.error("Notifications add error:", err);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

export default router;
