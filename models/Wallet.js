// models/Wallet.js - ES Module Version
import { db, FieldValue } from '../firebase.js';

class Wallet {
  constructor(userId) {
    this.userId = userId;
    this.db = db;
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
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        transactionCount: 0
      };
      await walletRef.set(newWallet);
      return newWallet;
    }

    return wallet.data();
  }

  async credit(amount, metadata = {}) {
    const walletRef = this.db.collection('wallets').doc(this.userId);
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = FieldValue.serverTimestamp();

    const transactionData = {
      id: transactionId,
      type: 'credit',
      amount: parseFloat(amount),
      ...metadata,
      timestamp: now,
      status: 'completed'
    };

    await this.db.runTransaction(async (t) => {
      const doc = await t.get(walletRef);
      const current = doc.data() || {};
      const isDeposit = metadata.source === 'deposit';
      const isSale = metadata.source === 'sale';

      t.update(walletRef, {
        balance: FieldValue.increment(parseFloat(amount)),
        totalDeposited: isDeposit ? FieldValue.increment(parseFloat(amount)) : (current.totalDeposited || 0),
        totalEarned: isSale ? FieldValue.increment(parseFloat(amount)) : (current.totalEarned || 0),
        updatedAt: now,
        transactionCount: FieldValue.increment(1)
      });
    });

    // Store transaction in subcollection (scalable)
    await this.db.collection('wallets').doc(this.userId).collection('transactions').doc(transactionId).set(transactionData);

    return transactionData;
  }

  async debit(amount, metadata = {}) {
    const walletRef = this.db.collection('wallets').doc(this.userId);
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = FieldValue.serverTimestamp();

    const transactionData = {
      id: transactionId,
      type: 'debit',
      amount: parseFloat(amount),
      ...metadata,
      timestamp: now,
      status: 'completed'
    };

    await this.db.runTransaction(async (t) => {
      const doc = await t.get(walletRef);
      const current = doc.data() || {};

      if ((current.balance || 0) < parseFloat(amount)) {
        throw new Error('Insufficient balance');
      }

      const isPurchase = metadata.purpose === 'purchase';
      const isWithdrawal = metadata.purpose === 'withdrawal';

      t.update(walletRef, {
        balance: FieldValue.increment(-parseFloat(amount)),
        totalSpent: isPurchase ? FieldValue.increment(parseFloat(amount)) : (current.totalSpent || 0),
        totalWithdrawn: isWithdrawal ? FieldValue.increment(parseFloat(amount)) : (current.totalWithdrawn || 0),
        updatedAt: now,
        transactionCount: FieldValue.increment(1)
      });
    });

    // Store transaction in subcollection
    await this.db.collection('wallets').doc(this.userId).collection('transactions').doc(transactionId).set(transactionData);

    return transactionData;
  }

  async holdEscrow(amount, productId) {
    const walletRef = this.db.collection('wallets').doc(this.userId);
    const escrowId = `esc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await this.db.runTransaction(async (t) => {
      const doc = await t.get(walletRef);
      const current = doc.data() || {};

      if ((current.balance || 0) < parseFloat(amount)) {
        throw new Error('Insufficient balance for escrow');
      }

      t.update(walletRef, {
        balance: FieldValue.increment(-parseFloat(amount)),
        escrowed: FieldValue.increment(parseFloat(amount)),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    // Create escrow record
    await this.db.collection('escrows').doc(escrowId).set({
      id: escrowId,
      buyerId: this.userId,
      productId,
      amount: parseFloat(amount),
      status: 'held',
      createdAt: FieldValue.serverTimestamp()
    });

    return escrowId;
  }

  async releaseEscrow(sellerId, amount, productId) {
    const buyerWalletRef = this.db.collection('wallets').doc(this.userId);
    const sellerWalletRef = this.db.collection('wallets').doc(sellerId);
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = FieldValue.serverTimestamp();

    const sellerTransaction = {
      id: transactionId,
      type: 'credit',
      amount: parseFloat(amount),
      source: 'sale',
      productId,
      timestamp: now,
      status: 'completed'
    };

    // ALL OPERATIONS IN SINGLE TRANSACTION - no race conditions
    await this.db.runTransaction(async (t) => {
      // Release from buyer's escrow
      t.update(buyerWalletRef, {
        escrowed: FieldValue.increment(-parseFloat(amount)),
        updatedAt: now
      });

      // Credit seller with transaction logged atomically
      t.update(sellerWalletRef, {
        balance: FieldValue.increment(parseFloat(amount)),
        totalEarned: FieldValue.increment(parseFloat(amount)),
        updatedAt: now,
        transactionCount: FieldValue.increment(1)
      });
    });

    // Store seller transaction in subcollection (outside transaction is fine here)
    await sellerWalletRef.collection('transactions').doc(transactionId).set(sellerTransaction);

    // Update escrow record
    const escrowQuery = await this.db.collection('escrows')
      .where('buyerId', '==', this.userId)
      .where('productId', '==', productId)
      .where('status', '==', 'held')
      .limit(1)
      .get();

    if (!escrowQuery.empty) {
      await escrowQuery.docs[0].ref.update({
        status: 'released',
        releasedAt: FieldValue.serverTimestamp()
      });
    }

    return transactionId;
  }

  // Get transactions from subcollection (paginated)
  async getTransactions(limit = 50, startAfter = null) {
    let query = this.db.collection('wallets').doc(this.userId).collection('transactions')
      .orderBy('timestamp', 'desc')
      .limit(limit);

    if (startAfter) {
      const startDoc = await this.db.collection('wallets').doc(this.userId).collection('transactions').doc(startAfter).get();
      if (startDoc.exists) {
        query = query.startAfter(startDoc);
      }
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}

export default Wallet;

