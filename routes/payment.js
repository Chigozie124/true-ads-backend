// routes/payment.js - ES Module Version
import express from 'express';
import axios from 'axios';
import { db, FieldValue } from '../firebase.js';
import Wallet from '../models/Wallet.js';

const router = express.Router();

// Validate environment variables at startup
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL;

if (!PAYSTACK_SECRET) {
  throw new Error('PAYSTACK_SECRET_KEY environment variable is required');
}
if (!FRONTEND_URL) {
  throw new Error('FRONTEND_URL environment variable is required');
}

// Initialize deposit (user adds money to wallet)
router.post('/initialize-deposit', async (req, res) => {
  try {
    const { userId, email, amount } = req.body;

    if (!userId || !email || !amount) {
      return res.status(400).json({
        success: false,
        message: 'userId, email, and amount are required'
      });
    }

    if (parseFloat(amount) < 100) {
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
        amount: Math.round(parseFloat(amount) * 100), // Convert to kobo
        callback_url: `${FRONTEND_URL}/wallet.html`,
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

    // Store pending transaction with idempotency key
    await db.collection('pendingTransactions').doc(reference).set({
      userId,
      type: 'deposit',
      amount: parseFloat(amount),
      reference,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      idempotencyKey: `init_${reference}` // Prevent double-processing
    });

    res.json({
      success: true,
      authorizationUrl: authorization_url,
      reference
    });

  } catch (error) {
    console.error('Deposit init error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Failed to initialize deposit'
    });
  }
});

// Verify deposit and credit wallet (Idempotent)
router.post('/verify-deposit', async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Reference is required'
      });
    }

    // Use transaction to prevent race conditions
    const result = await db.runTransaction(async (transaction) => {
      const pendingRef = db.collection('pendingTransactions').doc(reference);
      const pendingDoc = await transaction.get(pendingRef);

      if (!pendingDoc.exists) {
        return { status: 'not_found' };
      }

      const pending = pendingDoc.data();

      // Already processed - return cached result
      if (pending.status === 'completed') {
        const wallet = new Wallet(pending.userId);
        const walletData = await wallet.getOrCreate();
        return { 
          status: 'already_completed', 
          userId: pending.userId,
          balance: walletData.balance 
        };
      }

      // Verify with Paystack
      const response = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
        }
      );

      const { data } = response.data;

      if (data.status !== 'success') {
        return { status: 'payment_failed', message: 'Payment not successful' };
      }

      // Verify amount matches (compare in kobo to avoid float issues)
      const paidAmountKobo = data.amount;
      const expectedAmountKobo = Math.round(pending.amount * 100);
      
      if (Math.abs(paidAmountKobo - expectedAmountKobo) > 1) {
        return { status: 'amount_mismatch' };
      }

      const paidAmount = paidAmountKobo / 100;

      // Credit wallet
      const wallet = new Wallet(pending.userId);
      const transactionRecord = await wallet.credit(paidAmount, {
        source: 'deposit',
        reference,
        paystackRef: data.reference,
        gateway: 'paystack',
        metadata: data.metadata
      });

      // Update pending transaction atomically
      transaction.update(pendingRef, {
        status: 'completed',
        processedAt: FieldValue.serverTimestamp(),
        paystackData: data,
        transactionId: transactionRecord.id
      });

      // Get updated balance
      const walletData = await wallet.getOrCreate();

      return {
        status: 'success',
        userId: pending.userId,
        amount: paidAmount,
        newBalance: walletData.balance
      };
    });

    // Handle transaction results
    switch (result.status) {
      case 'not_found':
        return res.status(404).json({
          success: false,
          message: 'Transaction not found'
        });
      case 'already_completed':
        return res.json({
          success: true,
          message: 'Already processed',
          balance: result.balance
        });
      case 'payment_failed':
        return res.status(400).json({
          success: false,
          message: result.message
        });
      case 'amount_mismatch':
        return res.status(400).json({
          success: false,
          message: 'Amount mismatch detected'
        });
      case 'success':
        return res.json({
          success: true,
          message: 'Wallet funded successfully',
          amount: result.amount,
          newBalance: result.newBalance
        });
      default:
        throw new Error('Unknown transaction status');
    }

  } catch (error) {
    console.error('Verify deposit error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Verification failed'
    });
  }
});

// Purchase product (using wallet balance)
router.post('/purchase', async (req, res) => {
  try {
    const { userId, productId, sellerId, amount } = req.body;

    if (!userId || !productId || !sellerId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'userId, productId, sellerId, and amount are required'
      });
    }

    const parsedAmount = parseFloat(amount);
    if (parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    const wallet = new Wallet(userId);
    const walletData = await wallet.getOrCreate();

    // Check balance
    if ((walletData.balance || 0) < parsedAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
        currentBalance: walletData.balance,
        required: parsedAmount
      });
    }

    // Deduct from buyer
    await wallet.debit(parsedAmount, {
      purpose: 'purchase',
      productId,
      sellerId
    });

    // Hold in escrow
    const escrowId = await wallet.holdEscrow(parsedAmount, productId);

    // Update product status
    await db.collection('products').doc(productId).update({
      status: 'sold',
      soldTo: userId,
      soldAt: FieldValue.serverTimestamp(),
      escrowAmount: parsedAmount,
      escrowStatus: 'held',
      escrowId
    });

    // Notify seller
    await db.collection('notifications').add({
      userId: sellerId,
      type: 'sale',
      title: 'New Sale!',
      message: `Your product has been purchased for ₦${parsedAmount}`,
      productId,
      amount: parsedAmount,
      read: false,
      createdAt: FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Purchase successful',
      escrowed: parsedAmount,
      escrowId
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

    if (!userId || !productId || !sellerId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'userId, productId, sellerId, and amount are required'
      });
    }

    // Release escrow to seller
    const wallet = new Wallet(userId);
    const transactionId = await wallet.releaseEscrow(sellerId, parseFloat(amount), productId);

    // Update product
    await db.collection('products').doc(productId).update({
      escrowStatus: 'released',
      deliveryStatus: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      releaseTransactionId: transactionId
    });

    // Update seller stats
    await db.collection('users').doc(sellerId).update({
      totalSales: FieldValue.increment(1)
    });

    res.json({
      success: true,
      message: 'Delivery confirmed, seller paid',
      transactionId
    });

  } catch (error) {
    console.error('Confirm delivery error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to confirm delivery'
    });
  }
});

// Request withdrawal (seller payout)
router.post('/withdraw', async (req, res) => {
  try {
    const { userId, amount, bankCode, accountNumber, accountName } = req.body;

    if (!userId || !amount || !bankCode || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message: 'userId, amount, bankCode, accountNumber, and accountName are required'
      });
    }

    const parsedAmount = parseFloat(amount);
    if (parsedAmount < 1000) {
      return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal is ₦1,000'
      });
    }

    const wallet = new Wallet(userId);
    const walletData = await wallet.getOrCreate();

    if ((walletData.balance || 0) < parsedAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
        available: walletData.balance
      });
    }

    // Create transfer recipient
    let recipientResponse;
    try {
      recipientResponse = await axios.post(
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
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.response?.data?.message || 'Failed to create transfer recipient'
      });
    }

    const recipientCode = recipientResponse.data.data.recipient_code;
    const withdrawalReference = `WD_${Date.now()}_${userId.substr(0, 6)}`;

    // Initiate transfer
    let transferResponse;
    try {
      transferResponse = await axios.post(
        'https://api.paystack.co/transfer',
        {
          source: 'balance',
          amount: Math.round(parsedAmount * 100),
          recipient: recipientCode,
          reason: 'Seller payout from True Ads',
          reference: withdrawalReference
        },
        {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
        }
      );
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.response?.data?.message || 'Transfer initiation failed'
      });
    }

    // Debit wallet only after transfer is initiated
    await wallet.debit(parsedAmount, {
      purpose: 'withdrawal',
      reference: withdrawalReference,
      recipientCode,
      bankDetails: { bankCode, accountNumber, accountName },
      paystackTransferRef: transferResponse.data.data.reference
    });

    res.json({
      success: true,
      message: 'Withdrawal initiated',
      reference: withdrawalReference,
      status: transferResponse.data.data.status,
      transferReference: transferResponse.data.data.reference
    });

  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Withdrawal failed'
    });
  }
});

// Get wallet balance and history (using subcollection)
router.get('/wallet/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, startAfter } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    const wallet = new Wallet(userId);
    const data = await wallet.getOrCreate();

    // Get transactions from subcollection
    const transactions = await wallet.getTransactions(parseInt(limit), startAfter);

    res.json({
      success: true,
      wallet: {
        balance: data.balance || 0,
        escrowed: data.escrowed || 0,
        totalEarned: data.totalEarned || 0,
        totalSpent: data.totalSpent || 0,
        totalWithdrawn: data.totalWithdrawn || 0,
        totalDeposited: data.totalDeposited || 0,
        currency: data.currency || 'NGN',
        transactionCount: data.transactionCount || 0
      },
      transactions
    });

  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to load wallet'
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
    console.error('Get banks error:', error);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Failed to load banks'
    });
  }
});

// Verify account number
router.post('/verify-account', async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;

    if (!accountNumber || !bankCode) {
      return res.status(400).json({
        success: false,
        message: 'accountNumber and bankCode are required'
      });
    }

    const response = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
      }
    );

    res.json({
      success: true,
      accountName: response.data.data.account_name,
      accountNumber: response.data.data.account_number,
      bankCode: response.data.data.bank_id
    });
  } catch (error) {
    console.error('Verify account error:', error);
    res.status(400).json({
      success: false,
      message: error.response?.data?.message || 'Account verification failed'
    });
  }
});

export default router;

