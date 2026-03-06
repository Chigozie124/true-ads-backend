// routes/wallet.js - Combined Model + Routes
import express from 'express';
import authenticateToken from '../middleware/auth.js';
import fetch from 'node-fetch';
import admin from 'firebase-admin';

const router = express.Router();

// ==================== WALLET CLASS (Your Existing Code) ====================

class Wallet {
  constructor(userId) {
    this.userId = userId;
    this.db = admin.firestore();
  }

  async getOrCreate() {
    const walletRef = this.db.collection('wallets').doc(this.userId);
    const wallet = await walletRef.get();

    if (!wallet.exists) {
      const newWallet = {
        userId: this.userId,
        balance: 0,
        escrowed: 0,
        totalDeposited: 0,
        totalWithdrawn: 0,
        totalEarned: 0,
        totalSpent: 0,
        currency: 'NGN',
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        transactions: []
      };
      await walletRef.set(newWallet);
      return newWallet;
    }

    return wallet.data();
  }

  async credit(amount, metadata = {}) {
    const walletRef = this.db.collection('wallets').doc(this.userId);

    const transaction = {
      id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'credit',
      amount: parseFloat(amount),
      ...metadata,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'completed'
    };

    await this.db.runTransaction(async (t) => {
      const doc = await t.get(walletRef);
      const current = doc.data();

      t.update(walletRef, {
        balance: admin.firestore.FieldValue.increment(parseFloat(amount)),
        totalDeposited: metadata.source === 'deposit'
          ? admin.firestore.FieldValue.increment(parseFloat(amount))
          : current.totalDeposited,
        totalEarned: metadata.source === 'sale'
          ? admin.firestore.FieldValue.increment(parseFloat(amount))
          : current.totalEarned,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        transactions: admin.firestore.FieldValue.arrayUnion(transaction)
      });
    });

    return transaction;
  }

  async debit(amount, metadata = {}) {
    const walletRef = this.db.collection('wallets').doc(this.userId);

    const transaction = {
      id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'debit',
      amount: parseFloat(amount),
      ...metadata,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'completed'
    };

    await this.db.runTransaction(async (t) => {
      const doc = await t.get(walletRef);
      const current = doc.data();

      if (current.balance < amount) {
        throw new Error('Insufficient balance');
      }

      t.update(walletRef, {
        balance: admin.firestore.FieldValue.increment(-parseFloat(amount)),
        totalSpent: metadata.purpose === 'purchase'
          ? admin.firestore.FieldValue.increment(parseFloat(amount))
          : current.totalSpent,
        totalWithdrawn: metadata.purpose === 'withdrawal'
          ? admin.firestore.FieldValue.increment(parseFloat(amount))
          : current.totalWithdrawn,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        transactions: admin.firestore.FieldValue.arrayUnion(transaction)
      });
    });

    return transaction;
  }

  async holdEscrow(amount, productId) {
    const walletRef = this.db.collection('wallets').doc(this.userId);

    await this.db.runTransaction(async (t) => {
      const doc = await t.get(walletRef);
      const current = doc.data();

      if (current.balance < amount) {
        throw new Error('Insufficient balance for escrow');
      }

      t.update(walletRef, {
        balance: admin.firestore.FieldValue.increment(-parseFloat(amount)),
        escrowed: admin.firestore.FieldValue.increment(parseFloat(amount)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await this.db.collection('escrows').add({
      buyerId: this.userId,
      productId,
      amount: parseFloat(amount),
      status: 'held',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  async releaseEscrow(sellerId, amount, productId) {
    const buyerWalletRef = this.db.collection('wallets').doc(this.userId);
    const sellerWalletRef = this.db.collection('wallets').doc(sellerId);

    await this.db.runTransaction(async (t) => {
      t.update(buyerWalletRef, {
        escrowed: admin.firestore.FieldValue.increment(-parseFloat(amount)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      t.update(sellerWalletRef, {
        balance: admin.firestore.FieldValue.increment(parseFloat(amount)),
        totalEarned: admin.firestore.FieldValue.increment(parseFloat(amount)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    const escrowQuery = await this.db.collection('escrows')
      .where('buyerId', '==', this.userId)
      .where('productId', '==', productId)
      .where('status', '==', 'held')
      .limit(1)
      .get();

    if (!escrowQuery.empty) {
      await escrowQuery.docs[0].ref.update({
        status: 'released',
        releasedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    await sellerWalletRef.update({
      transactions: admin.firestore.FieldValue.arrayUnion({
        id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'credit',
        amount: parseFloat(amount),
        source: 'sale',
        productId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'completed'
      })
    });
  }
}

// ==================== ROUTE HANDLERS (New Code) ====================

// Get wallet data
router.get('/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (req.user.uid !== userId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        
        const wallet = new Wallet(userId);
        const walletData = await wallet.getOrCreate();
        
        const stats = {
            purchases: walletData.transactions?.filter(t => t.purpose === 'purchase').length || 0,
            sales: walletData.transactions?.filter(t => t.source === 'sale').length || 0,
            totalTransactions: walletData.transactions?.length || 0
        };
        
        res.json({
            success: true,
            balance: walletData.balance || 0,
            escrowed: walletData.escrowed || 0,
            stats: stats,
            transactions: walletData.transactions || []
        });
    } catch (error) {
        console.error('Get wallet error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Verify Paystack deposit
router.post('/deposit/verify', authenticateToken, async (req, res) => {
    try {
        const { reference, amount, userId } = req.body;
        
        if (req.user.uid !== userId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        
        const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { 
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` 
            }
        });
        
        const paystackData = await paystackResponse.json();
        
        if (paystackData.data && paystackData.data.status === 'success') {
            const wallet = new Wallet(userId);
            const transaction = await wallet.credit(amount, {
                source: 'deposit',
                method: 'Card',
                reference: reference,
                description: 'Card Deposit via Paystack'
            });
            
            res.json({ 
                success: true, 
                message: 'Payment verified and wallet credited',
                transaction: transaction
            });
        } else {
            res.status(400).json({ 
                success: false, 
                message: 'Payment verification failed'
            });
        }
    } catch (error) {
        console.error('Deposit verify error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Withdraw
router.post('/withdraw', authenticateToken, async (req, res) => {
    try {
        const { userId, amount, method, accountDetails } = req.body;
        
        if (req.user.uid !== userId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        
        const wallet = new Wallet(userId);
        const walletData = await wallet.getOrCreate();
        
        if (walletData.balance < parseFloat(amount)) {
            return res.status(400).json({ success: false, message: 'Insufficient balance' });
        }
        
        const transaction = await wallet.debit(amount, {
            purpose: 'withdrawal',
            method: method,
            accountDetails: accountDetails,
            description: `Withdrawal to ${method}`
        });
        
        res.json({ 
            success: true, 
            message: 'Withdrawal processed',
            transaction: transaction
        });
    } catch (error) {
        console.error('Withdraw error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Transfer
router.post('/transfer', authenticateToken, async (req, res) => {
    try {
        const { senderId, recipientIdentifier, amount, note } = req.body;
        
        if (req.user.uid !== senderId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        
        const db = admin.firestore();
        let recipientId = recipientIdentifier;
        let recipientQuery = await db.collection('users').where('email', '==', recipientIdentifier).get();
        
        if (!recipientQuery.empty) {
            recipientId = recipientQuery.docs[0].id;
        }
        
        if (recipientId === senderId) {
            return res.status(400).json({ success: false, message: 'Cannot transfer to yourself' });
        }
        
        const senderWallet = new Wallet(senderId);
        const senderData = await senderWallet.getOrCreate();
        
        if (senderData.balance < parseFloat(amount)) {
            return res.status(400).json({ success: false, message: 'Insufficient balance' });
        }
        
        await senderWallet.debit(amount, {
            purpose: 'transfer',
            recipient: recipientIdentifier,
            note: note,
            description: `Transfer to ${recipientIdentifier}`
        });
        
        try {
            const recipientWallet = new Wallet(recipientId);
            await recipientWallet.credit(amount, {
                source: 'transfer',
                sender: senderId,
                note: note,
                description: `Received from ${senderId}`
            });
        } catch (e) {
            console.log('Recipient wallet issue:', e);
        }
        
        res.json({ 
            success: true, 
            message: 'Transfer completed',
            recipientName: recipientIdentifier 
        });
    } catch (error) {
        console.error('Transfer error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Subscribe/Upgrade
router.post('/subscribe', authenticateToken, async (req, res) => {
    try {
        const { userId, plan, amount } = req.body;
        
        if (req.user.uid !== userId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        
        const wallet = new Wallet(userId);
        const walletData = await wallet.getOrCreate();
        
        if (walletData.balance < parseFloat(amount)) {
            return res.status(400).json({ success: false, message: 'Insufficient balance' });
        }
        
        await wallet.debit(amount, {
            purpose: 'subscription',
            plan: plan,
            description: `Pro Plan Subscription`
        });
        
        await admin.firestore().collection('users').doc(userId).update({
            plan: 'pro',
            planExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
        
        res.json({ success: true, message: 'Upgraded to Pro' });
    } catch (error) {
        console.error('Subscribe error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Virtual account
router.post('/virtual-account', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (req.user.uid !== userId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        
        if (userData.virtualAccount) {
            return res.json({ success: true, ...userData.virtualAccount });
        }
        
        const virtualAccount = {
            accountNumber: '1234567890',
            bankName: 'Wema Bank',
            accountName: `True Ads - ${userData.email}`,
            provider: 'paystack'
        };
        
        await db.collection('users').doc(userId).update({ virtualAccount });
        
        res.json({ success: true, ...virtualAccount });
    } catch (error) {
        console.error('Virtual account error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Health check
router.get('/health', (req, res) => {
    res.json({ status: 'Wallet API OK', time: new Date().toISOString() });
});

export default router;

