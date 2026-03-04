// routes/payment.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const admin = require('firebase-admin');
const Wallet = require('../models/Wallet');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY;

// Initialize deposit (user adds money to wallet)
router.post('/initialize-deposit', async (req, res) => {
  try {
    const { userId, email, amount } = req.body;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Minimum deposit is ₦100' 
      });
    }

    // Initialize with Paystack
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: Math.round(amount * 100), // Convert to kobo
        callback_url: `${process.env.FRONTEND_URL}/payment-callback.html`,
        metadata: {
          userId,
          type: 'wallet_deposit',
          custom_fields: [
            {
              display_name: "Deposit Type",
              variable_name: "deposit_type",
              value: "Wallet Funding"
            }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { authorization_url, reference } = response.data.data;

    // Store pending transaction
    await admin.firestore().collection('pendingTransactions').doc(reference).set({
      userId,
      type: 'deposit',
      amount: parseFloat(amount),
      reference,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      authorizationUrl: authorization_url,
      reference
    });

  } catch (error) {
    console.error('Deposit init error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to initialize deposit' 
    });
  }
});

// Verify deposit and credit wallet
router.post('/verify-deposit', async (req, res) => {
  try {
    const { reference } = req.body;

    // Verify with Paystack
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
      }
    );

    const { data } = response.data;

    if (data.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Payment not successful'
      });
    }

    // Get pending transaction
    const pendingRef = admin.firestore().collection('pendingTransactions').doc(reference);
    const pendingDoc = await pendingRef.get();
    
    if (!pendingDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const pending = pendingDoc.data();
    
    // Check if already processed
    if (pending.status === 'completed') {
      return res.json({
        success: true,
        message: 'Already processed',
        balance: (await new Wallet(pending.userId).getOrCreate()).balance
      });
    }

    // Verify amount matches
    const paidAmount = data.amount / 100;
    if (Math.abs(paidAmount - pending.amount) > 1) {
      return res.status(400).json({
        success: false,
        message: 'Amount mismatch'
      });
    }

    // Credit wallet
    const wallet = new Wallet(pending.userId);
    await wallet.credit(paidAmount, {
      source: 'deposit',
      reference,
      paystackRef: data.reference,
      gateway: 'paystack',
      metadata: data.metadata
    });

    // Update pending transaction
    await pendingRef.update({
      status: 'completed',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      paystackData: data
    });

    // Get updated balance
    const walletData = await wallet.getOrCreate();

    res.json({
      success: true,
      message: 'Wallet funded successfully',
      amount: paidAmount,
      newBalance: walletData.balance
    });

  } catch (error) {
    console.error('Verify deposit error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed'
    });
  }
});

// Purchase product (using wallet balance)
router.post('/purchase', async (req, res) => {
  try {
    const { userId, productId, sellerId, amount } = req.body;

    const wallet = new Wallet(userId);
    const walletData = await wallet.getOrCreate();

    // Check balance
    if (walletData.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
        currentBalance: walletData.balance,
        required: amount
      });
    }

    // Deduct from buyer
    await wallet.debit(amount, {
      purpose: 'purchase',
      productId,
      sellerId
    });

    // Hold in escrow
    await wallet.holdEscrow(amount, productId);

    // Update product status
    await admin.firestore().collection('products').doc(productId).update({
      status: 'sold',
      soldTo: userId,
      soldAt: admin.firestore.FieldValue.serverTimestamp(),
      escrowAmount: amount,
      escrowStatus: 'held'
    });

    // Notify seller
    await admin.firestore().collection('notifications').add({
      userId: sellerId,
      type: 'sale',
      title: 'New Sale!',
      message: `Your product has been purchased for ₦${amount}`,
      productId,
      amount,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Purchase successful',
      escrowed: amount
    });

  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Purchase failed'
    });
  }
});

// Confirm delivery and release funds
router.post('/confirm-delivery', async (req, res) => {
  try {
    const { userId, productId, sellerId, amount } = req.body;

    // Release escrow to seller
    const wallet = new Wallet(userId);
    await wallet.releaseEscrow(sellerId, amount, productId);

    // Update product
    await admin.firestore().collection('products').doc(productId).update({
      escrowStatus: 'released',
      deliveryStatus: 'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update seller stats
    await admin.firestore().collection('users').doc(sellerId).update({
      totalSales: admin.firestore.FieldValue.increment(1)
    });

    res.json({
      success: true,
      message: 'Delivery confirmed, seller paid'
    });

  } catch (error) {
    console.error('Confirm delivery error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Request withdrawal (seller payout)
router.post('/withdraw', async (req, res) => {
  try {
    const { userId, amount, bankCode, accountNumber, accountName } = req.body;

    if (!amount || amount < 1000) {
      return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal is ₦1,000'
      });
    }

    const wallet = new Wallet(userId);
    const walletData = await wallet.getOrCreate();

    if (walletData.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
        available: walletData.balance
      });
    }

    // Create transfer recipient
    const recipientResponse = await axios.post(
      'https://api.paystack.co/transferrecipient',
      {
        type: 'nuban',
        name: accountName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN'
      },
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
      }
    );

    const recipientCode = recipientResponse.data.data.recipient_code;

    // Initiate transfer
    const transferResponse = await axios.post(
      'https://api.paystack.co/transfer',
      {
        source: 'balance',
        amount: Math.round(amount * 100),
        recipient: recipientCode,
        reason: 'Seller payout from True Ads',
        reference: `WD_${Date.now()}_${userId.substr(0, 6)}`
      },
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
      }
    );

    // Debit wallet
    await wallet.debit(amount, {
      purpose: 'withdrawal',
      reference: transferResponse.data.data.reference,
      recipientCode,
      bankDetails: { bankCode, accountNumber, accountName }
    });

    res.json({
      success: true,
      message: 'Withdrawal initiated',
      reference: transferResponse.data.data.reference,
      status: transferResponse.data.data.status
    });

  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Withdrawal failed'
    });
  }
});

// Get wallet balance and history
router.get('/wallet/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const wallet = new Wallet(userId);
    const data = await wallet.getOrCreate();
    
    // Get recent transactions (last 50)
    const transactions = (data.transactions || [])
      .sort((a, b) => b.timestamp?.seconds - a.timestamp?.seconds)
      .slice(0, 50);

    res.json({
      success: true,
      wallet: {
        balance: data.balance,
        escrowed: data.escrowed,
        totalEarned: data.totalEarned,
        totalSpent: data.totalSpent,
        totalWithdrawn: data.totalWithdrawn,
        currency: data.currency
      },
      transactions
    });

  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load wallet'
    });
  }
});

// Get banks list
router.get('/banks', async (req, res) => {
  try {
    const response = await axios.get('https://api.paystack.co/bank', {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });

    res.json({
      success: true,
      banks: response.data.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to load banks'
    });
  }
});

// Verify account number
router.post('/verify-account', async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;
    
    const response = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
      }
    );

    res.json({
      success: true,
      accountName: response.data.data.account_name
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Account verification failed'
    });
  }
});

module.exports = router;

