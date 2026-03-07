import express from 'express';
import fetch from 'node-fetch';
import admin from 'firebase-admin';
import authenticateToken from '../middleware/auth.js';
import Wallet from '../models/Wallet.js';

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'Wallet API OK',
    time: new Date().toISOString(),
    message: 'Wallet API is running'
  });
});

router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || req.user.uid !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const wallet = new Wallet(userId);
    const walletData = await wallet.getOrCreate();
    const transactions = await wallet.getTransactions(50);

    const stats = {
      purchases: transactions.filter(t => t.purpose === 'purchase').length,
      sales: transactions.filter(t => t.source === 'sale').length,
      totalTransactions: transactions.length
    };

    res.json({
      success: true,
      balance: walletData.balance || 0,
      escrowed: walletData.escrowed || 0,
      totalDeposited: walletData.totalDeposited || 0,
      totalWithdrawn: walletData.totalWithdrawn || 0,
      totalEarned: walletData.totalEarned || 0,
      totalSpent: walletData.totalSpent || 0,
      currency: walletData.currency || 'NGN',
      status: walletData.status || 'active',
      stats,
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

router.post('/deposit/verify', authenticateToken, async (req, res) => {
  try {
    const { reference, amount, userId } = req.body;

    if (!reference || !amount || !userId) {
      return res.status(400).json({
        success: false,
        message: 'reference, amount and userId are required'
      });
    }

    if (req.user.uid !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const paystackData = await paystackResponse.json();

    if (paystackData?.data?.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }

    const paidAmount = (paystackData.data.amount || 0) / 100;
    const expectedAmount = parseFloat(amount);

    if (Math.abs(paidAmount - expectedAmount) > 1) {
      return res.status(400).json({
        success: false,
        message: 'Amount mismatch detected'
      });
    }

    const wallet = new Wallet(userId);
    const transaction = await wallet.credit(expectedAmount, {
      source: 'deposit',
      method: 'Card',
      reference,
      description: 'Card Deposit via Paystack'
    });

    res.json({
      success: true,
      message: 'Payment verified and wallet credited',
      transaction
    });
  } catch (error) {
    console.error('Deposit verify error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Deposit verification failed'
    });
  }
});

router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { userId, amount, method, accountDetails } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!userId || !parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid userId and amount are required'
      });
    }

    if (req.user.uid !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const wallet = new Wallet(userId);
    const walletData = await wallet.getOrCreate();

    if ((walletData.balance || 0) < parsedAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    const transaction = await wallet.debit(parsedAmount, {
      purpose: 'withdrawal',
      method: method || 'bank',
      accountDetails: accountDetails || {},
      description: `Withdrawal to ${method || 'bank'}`
    });

    res.json({
      success: true,
      message: 'Withdrawal processed',
      transaction
    });
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Withdrawal failed'
    });
  }
});

router.post('/transfer', authenticateToken, async (req, res) => {
  try {
    const { senderId, recipientIdentifier, amount, note } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!senderId || !recipientIdentifier || !parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'senderId, recipientIdentifier and valid amount are required'
      });
    }

    if (req.user.uid !== senderId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const db = admin.firestore();
    let recipientId = recipientIdentifier;

    const recipientQuery = await db
      .collection('users')
      .where('email', '==', recipientIdentifier)
      .limit(1)
      .get();

    if (!recipientQuery.empty) {
      recipientId = recipientQuery.docs[0].id;
    }

    if (recipientId === senderId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer to yourself'
      });
    }

    const senderWallet = new Wallet(senderId);
    const senderData = await senderWallet.getOrCreate();

    if ((senderData.balance || 0) < parsedAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    await senderWallet.debit(parsedAmount, {
      purpose: 'transfer',
      recipient: recipientIdentifier,
      note: note || '',
      description: `Transfer to ${recipientIdentifier}`
    });

    try {
      const recipientWallet = new Wallet(recipientId);
      await recipientWallet.getOrCreate();
      await recipientWallet.credit(parsedAmount, {
        source: 'transfer',
        sender: senderId,
        note: note || '',
        description: `Received from ${senderId}`
      });
    } catch (recipientError) {
      console.log('Recipient wallet issue:', recipientError);
    }

    res.json({
      success: true,
      message: 'Transfer completed',
      recipientName: recipientIdentifier
    });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Transfer failed'
    });
  }
});

router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const { userId, plan, amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!userId || !plan || !parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'userId, plan and valid amount are required'
      });
    }

    if (req.user.uid !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const wallet = new Wallet(userId);
    const walletData = await wallet.getOrCreate();

    if ((walletData.balance || 0) < parsedAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    await wallet.debit(parsedAmount, {
      purpose: 'subscription',
      plan,
      description: `${String(plan).toUpperCase()} Plan Subscription`
    });

    await admin.firestore().collection('users').doc(userId).set({
      plan: String(plan).toLowerCase(),
      planExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }, { merge: true });

    res.json({
      success: true,
      message: 'Upgraded successfully'
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Subscription failed'
    });
  }
});

router.post('/virtual-account', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId || req.user.uid !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Paystack secret key is missing'
      });
    }

    const db = admin.firestore();
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const userData = userDoc.data() || {};

    if (
      userData.virtualAccount &&
      userData.virtualAccount.accountNumber &&
      userData.virtualAccount.bankName &&
      userData.virtualAccount.provider === 'paystack' &&
      userData.virtualAccount.dedicatedAccountId
    ) {
      return res.json({
        success: true,
        bankName: userData.virtualAccount.bankName,
        accountNumber: userData.virtualAccount.accountNumber,
        accountName: userData.virtualAccount.accountName || 'True Ads User',
        provider: userData.virtualAccount.provider,
        customerCode: userData.virtualAccount.customerCode || null,
        dedicatedAccountId: userData.virtualAccount.dedicatedAccountId || null
      });
    }

    const email = String(userData.email || '').trim();
    const fullName = String(
      userData.fullName ||
      userData.displayName ||
      userData.name ||
      ''
    ).trim();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'User email is required for virtual account creation'
      });
    }

    const nameParts = fullName.split(' ').filter(Boolean);
    const firstName = nameParts[0] || 'True';
    const lastName = nameParts.slice(1).join(' ') || 'Ads';

    let customerCode = userData.paystackCustomerCode || null;

    if (!customerCode) {
      const customerResponse = await fetch('https://api.paystack.co/customer', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          phone: userData.phone || undefined
        })
      });

      const customerData = await customerResponse.json();

      if (!customerResponse.ok || !customerData.status) {
        return res.status(400).json({
          success: false,
          message: customerData.message || 'Failed to create Paystack customer'
        });
      }

      customerCode = customerData.data.customer_code;

      await userRef.set({
        paystackCustomerCode: customerCode
      }, { merge: true });
    }

    const dedicatedResponse = await fetch('https://api.paystack.co/dedicated_account', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer: customerCode,
        preferred_bank: 'wema-bank'
      })
    });

    const dedicatedData = await dedicatedResponse.json();

    if (!dedicatedResponse.ok || !dedicatedData.status) {
      return res.status(400).json({
        success: false,
        message: dedicatedData.message || 'Failed to create dedicated account'
      });
    }

    const account = dedicatedData.data || {};

    const virtualAccount = {
      accountName: account.account_name || `True Ads - ${fullName || email}`,
      accountNumber: account.account_number || '',
      bankName: account.bank?.name || 'Wema Bank',
      provider: 'paystack',
      customerCode,
      dedicatedAccountId: account.id || null,
      assignedAt: new Date().toISOString()
    };

    await userRef.set({
      virtualAccount
    }, { merge: true });

    res.json({
      success: true,
      ...virtualAccount
    });
  } catch (error) {
    console.error('Virtual account error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to load virtual account'
    });
  }
});

export default router;
