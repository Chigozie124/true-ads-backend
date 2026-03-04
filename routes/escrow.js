// routes/escrow.js - ES Module Version
import express from 'express';
import admin from 'firebase-admin';
import Wallet from '../models/Wallet.js';

const router = express.Router();

// Get escrow details
router.get('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    const escrowQuery = await admin.firestore()
      .collection('escrows')
      .where('productId', '==', productId)
      .limit(1)
      .get();

    if (escrowQuery.empty) {
      return res.status(404).json({
        success: false,
        message: 'Escrow not found'
      });
    }

    const escrow = escrowQuery.docs[0].data();
    
    res.json({
      success: true,
      escrow: {
        id: escrowQuery.docs[0].id,
        ...escrow
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to load escrow'
    });
  }
});

// Refund buyer (admin only)
router.post('/refund', async (req, res) => {
  try {
    const { productId, adminId, reason } = req.body;

    // Verify admin
    const adminDoc = await admin.firestore().collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const product = await admin.firestore().collection('products').doc(productId).get();
    if (!product.exists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const data = product.data();
    
    // Refund to buyer
    const wallet = new Wallet(data.soldTo);
    await wallet.credit(data.escrowAmount, {
      source: 'refund',
      productId,
      reason,
      processedBy: adminId
    });

    // Update product
    await product.ref.update({
      escrowStatus: 'refunded',
      disputeStatus: 'resolved',
      refundReason: reason,
      refundedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Buyer refunded successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;

