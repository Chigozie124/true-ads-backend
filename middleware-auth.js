import { auth, db } from "./firebase.js";

/*
  VERIFY TOKEN + BAN CHECK MIDDLEWARE
  - Verifies Firebase ID token
  - Checks if user exists
  - Blocks banned users
*/

const verifyToken = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    // 1️⃣ Check if token exists
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: No token provided"
      });
    }

    // 2️⃣ Extract token
    const token = header.split("Bearer ")[1];

    // 3️⃣ Verify Firebase token
    const decoded = await auth.verifyIdToken(token);

    // 4️⃣ Get user document from Firestore
    const userRef = db.collection("users").doc(decoded.uid);
    const userDoc = await userRef.get();

    // 5️⃣ If user not found
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "User record not found"
      });
    }

    const userData = userDoc.data();

    // 6️⃣ BAN CHECK
    if (userData.banned === true) {
      return res.status(403).json({
        success: false,
        error: "Account has been banned"
      });
    }

    // 7️⃣ Attach user to request
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      role: userData.role || "user"
    };

    next();

  } catch (error) {
    console.error("Auth Middleware Error:", error);

    return res.status(401).json({
      success: false,
      error: "Invalid or expired token"
    });
  }
};

export default verifyToken;
