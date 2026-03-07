// middleware/auth.js - FIXED for Firebase
import admin from 'firebase-admin';

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        const idToken = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify Firebase ID token
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        
        // Get user from Firestore
        const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
        
        if (!userDoc.exists) {
            return res.status(401).json({ error: 'User not found in database.' });
        }

        const userData = userDoc.data();
        
        // Check if banned
        if (userData.banned) {
            return res.status(403).json({ error: 'Account banned.' });
        }

        // Attach user info to request
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            ...userData
        };

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expired.' });
        }
        if (error.code === 'auth/id-token-revoked') {
            return res.status(401).json({ error: 'Token revoked.' });
        }
        res.status(401).json({ error: 'Invalid token.' });
    }
};

// Verify admin role
export const verifyAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
};

export default authenticateToken;

