import express from 'express';
import axios from 'axios';
import authenticateToken from '../middleware/auth.js';
import { db, FieldValue } from '../firebase.js';
import Wallet from '../models/Wallet.js';

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL;

if (!PAYSTACK_SECRET) {
  throw new Error('PAYSTACK_SECRET_KEY environment variable is required');
}

if (!FRONTEND_URL) {
  throw new Error('FRONTEND_URL environment variable is required');
}

router.post('/initialize-deposit', authenticateToken, async (req, res) => {
  try {
    const { userId, email, amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!userId || !email || !parsedAmount || parsedAmount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Valid userId, email, and amount are required. Minimum deposit is ₦100'
      });
    }

    if (req.user.uid !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: Math.round(parsedAmount * 100),
        callback_url: `${FRONTEND_URL}/wallet.html`,
        metadata: {
          userId,
          type: 'wallet_deposit',
          custom_fields: [
            {
              display_name: 'Deposit Type',
              variable_name: 'deposit_type',
              value: 'Wallet Funding'
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

    await db.collection('pendingTransactions').doc(reference).set({
      userId,
      email,
      type: 'deposit',
      amount: parsedAmount,
      reference,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      idempotencyKey: `init_${reference}`
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

router.post('/verify-deposit', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Reference is required'
      });
    }

    const result = await db.runTransaction(async (transaction) => {
      const pendingRef = db.collection('pendingTransactions').doc(reference);
      const pendingDoc = await transaction.get(pendingRef);

      if (!pendingDoc.exists) {
        return { status: 'not_found' };
      }

      const pending = pendingDoc.data();

      if (pending.userId !== req.user.uid) {
        return { status: 'unauthorized' };
      }

      if (pending.status === 'completed') {
        const wallet = new Wallet(pending.userId);
        const walletData = await wallet.getOrCreate();

        return {
          status: 'already_completed',
          userId: pending.userId,
          balance: walletData.balance || 0
        };
      }

      const response = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET}`
          }
        }
      );

      const { data } = response.data;

      if (data.status !== 'success') {
        return {
          status: 'payment_failed',
          message: 'Payment not successful'
        };
      }

      const paidAmountKobo = data.amount;
      const expectedAmountKobo = Math.round((pending.amount || 0) * 100);

      if (Math.abs(paidAmountKobo - expectedAmountKobo) > 1) {
        return { status: 'amount_mismatch' };
      }

      const paidAmount = paidAmountKobo / 100;

      const wallet = new Wallet(pending.userId);
      const transactionRecord = await wallet.credit(paidAmount, {
        source: 'deposit',
        reference,
        paystackRef: data.reference,
        gateway: 'paystack',
        description: 'Wallet funding via Paystack',
        metadata: data.metadata || {}
      });

      transaction.update(pendingRef, {
        status: 'completed',
        processedAt: FieldValue.serverTimestamp(),
        paystackData: data,
        transactionId: transactionRecord.id
      });

      const walletData = await wallet.getOrCreate();

      return {
        status: 'success',
        userId: pending.userId,
        amount: paidAmount,
        newBalance: walletData.balance || 0
      };
    });

    switch (result.status) {
      case 'not_found':
        return res.status(404).json({
          success: false,
          message: 'Transaction not found'
        });

      case 'unauthorized':
        return res.status(403).json({
          success: false,
          message: 'Unauthorized'
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

router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { userId, amount, bankCode, accountNumber, accountName } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!userId || !parsedAmount || !bankCode || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message: 'userId, amount, bankCode, accountNumber, and accountName are required'
      });
    }

if (parsedAmount < 100) {
  return res.status(400).json({
    success: false,
    message: 'Minimum withdrawal is ₦100'
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
        message: 'Insufficient balance',
        available: walletData.balance || 0
      });
    }

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
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.response?.data?.message || 'Failed to create transfer recipient'
      });
    }

    const recipientCode = recipientResponse.data.data.recipient_code;
    const withdrawalReference = `WD_${Date.now()}_${userId.slice(0, 6)}`;

    let transferResponse;
    try {
      transferResponse = await axios.post(
        'https://api.paystack.co/transfer',
        {
          source: 'balance',
          amount: Math.round(parsedAmount * 100),
          recipient: recipientCode,
          reason: 'True Ads wallet withdrawal',
          reference: withdrawalReference
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.response?.data?.message || 'Transfer initiation failed'
      });
    }

    await wallet.debit(parsedAmount, {
      purpose: 'withdrawal',
      reference: withdrawalReference,
      recipientCode,
      bankDetails: { bankCode, accountNumber, accountName },
      paystackTransferRef: transferResponse.data.data.reference,
      description: `Withdrawal to ${accountName}`
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

router.get('/banks', async (req, res) => {
  try {
    const response = await axios.get('https://api.paystack.co/bank', {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`
      }
    });

    res.json({
      success: true,
      banks: response.data.data || []
    });
  } catch (error) {
    console.error('Get banks error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Failed to load banks'
    });
  }
});

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
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`
        }
      }
    );

    res.json({
      success: true,
      accountName: response.data.data.account_name,
      accountNumber: response.data.data.account_number,
      bankCode: bankCode
    });
  } catch (error) {
    console.error('Verify account error:', error.response?.data || error.message);
    res.status(400).json({
      success: false,
      message: error.response?.data?.message || 'Account verification failed'
    });
  }
});

export default router;
