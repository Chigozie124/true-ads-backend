// routes/payment.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const admin = require('firebase-admin');

// Verify Paystack payment
router.post('/verify-payment', async (req, res) => {
  try {
    const { reference, productId, sellerId, buyerId, amount } = req.body;
    
    // Verify with Paystack
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const { data } = response.data;

    if (data.status !== 'success') {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment not successful' 
      });
    }

    // Verify amounts match
    if (data.amount !== Math.round(amount * 100)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Amount mismatch' 
      });
    }

    // Create escrow record
    await admin.firestore().collection('escrows').add({
      productId,
      sellerId,
      buyerId,
      amount: parseFloat(amount),
      paystackRef: reference,
      status: 'held',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      releasedAt: null
    });

    res.json({ 
      success: true, 
      message: 'Payment verified and escrow created',
      data: {
        reference,
        amount: data.amount / 100
      }
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Verification failed' 
    });
  }
});

module.exports = router;

