
import { db, FieldValue } from '../firebase.js';

class Wallet {
  constructor(userId) {
    this.userId = userId;
    this.db = db;
  }

  async getOrCreate() {
    const walletRef = this.db.collection('wallets').doc(this.userId);
    const walletDoc = await walletRef.get();

    if (!walletDoc.exists) {
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

      return {
        ...newWallet,
        transactionCount: 0
      };
    }

    return walletDoc.data();
  }

  async credit(amount, metadata = {}) {
    const parsedAmount = parseFloat(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      throw new Error('Invalid credit amount');
    }

    const walletRef = this.db.collection('wallets').doc(this.userId);
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const now = FieldValue.serverTimestamp();

    const transactionData = {
      id: transactionId,
      type: 'credit',
      amount: parsedAmount,
      ...metadata,
      timestamp: now,
      status: 'completed'
    };

    await this.db.runTransaction(async (t) => {
      const doc = await t.get(walletRef);

      if (!doc.exists) {
        throw new Error('Wallet not found');
      }

      const isDeposit = metadata.source === 'deposit';
      const isSale = metadata.source === 'sale';

      t.update(walletRef, {
        balance: FieldValue.increment(parsedAmount),
        totalDeposited: isDeposit ? FieldValue.increment(parsedAmount) : FieldValue.increment(0),
        totalEarned: isSale ? FieldValue.increment(parsedAmount) : FieldValue.increment(0),
        updatedAt: now,
        transactionCount: FieldValue.increment(1)
      });
    });

    await walletRef.collection('transactions').doc(transactionId).set(transactionData);

    return transactionData;
  }

  async debit(amount, metadata = {}) {
    const parsedAmount = parseFloat(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      throw new Error('Invalid debit amount');
    }

    const walletRef = this.db.collection('wallets').doc(this.userId);
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const now = FieldValue.serverTimestamp();

    const transactionData = {
      id: transactionId,
      type: 'debit',
      amount: parsedAmount,
      ...metadata,
      timestamp: now,
      status: 'completed'
    };

    await this.db.runTransaction(async (t) => {
      const doc = await t.get(walletRef);

      if (!doc.exists) {
        throw new Error('Wallet not found');
      }

      const current = doc.data() || {};

      if ((current.balance || 0) < parsedAmount) {
        throw new Error('Insufficient balance');
      }

      const isPurchase = metadata.purpose === 'purchase';
      const isWithdrawal = metadata.purpose === 'withdrawal';
      const isSubscription = metadata.purpose === 'subscription';
      const isTransfer = metadata.purpose === 'transfer';

      t.update(walletRef, {
        balance: FieldValue.increment(-parsedAmount),
        totalSpent: (isPurchase || isSubscription || isTransfer)
          ? FieldValue.increment(parsedAmount)
          : FieldValue.increment(0),
        totalWithdrawn: isWithdrawal
          ? FieldValue.increment(parsedAmount)
          : FieldValue.increment(0),
        updatedAt: now,
        transactionCount: FieldValue.increment(1)
      });
    });

    await walletRef.collection('transactions').doc(transactionId).set(transactionData);

    return transactionData;
  }

  async holdEscrow(amount, productId) {
    const parsedAmount = parseFloat(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      throw new Error('Invalid escrow amount');
    }

    const walletRef = this.db.collection('wallets').doc(this.userId);
    const escrowId = `esc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    await this.db.runTransaction(async (t) => {
      const doc = await t.get(walletRef);

      if (!doc.exists) {
        throw new Error('Wallet not found');
      }

      const current = doc.data() || {};

      if ((current.balance || 0) < parsedAmount) {
        throw new Error('Insufficient balance for escrow');
      }

      t.update(walletRef, {
        balance: FieldValue.increment(-parsedAmount),
        escrowed: FieldValue.increment(parsedAmount),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    await this.db.collection('escrows').doc(escrowId).set({
      id: escrowId,
      buyerId: this.userId,
      productId,
      amount: parsedAmount,
      status: 'held',
      createdAt: FieldValue.serverTimestamp()
    });

    return escrowId;
  }

  async releaseEscrow(sellerId, amount, productId) {
    const parsedAmount = parseFloat(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      throw new Error('Invalid release amount');
    }

    const buyerWalletRef = this.db.collection('wallets').doc(this.userId);
    const sellerWalletRef = this.db.collection('wallets').doc(sellerId);
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const now = FieldValue.serverTimestamp();

    const sellerTransaction = {
      id: transactionId,
      type: 'credit',
      amount: parsedAmount,
      source: 'sale',
      productId,
      timestamp: now,
      status: 'completed'
    };

    await this.db.runTransaction(async (t) => {
      const buyerDoc = await t.get(buyerWalletRef);
      const sellerDoc = await t.get(sellerWalletRef);

      if (!buyerDoc.exists) {
        throw new Error('Buyer wallet not found');
      }

      if (!sellerDoc.exists) {
        t.set(sellerWalletRef, {
          userId: sellerId,
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
        });
      }

      t.update(buyerWalletRef, {
        escrowed: FieldValue.increment(-parsedAmount),
        updatedAt: now
      });

      t.set(sellerWalletRef, {
        userId: sellerId,
        balance: FieldValue.increment(parsedAmount),
        totalEarned: FieldValue.increment(parsedAmount),
        updatedAt: now,
        transactionCount: FieldValue.increment(1)
      }, { merge: true });
    });

    await sellerWalletRef.collection('transactions').doc(transactionId).set(sellerTransaction);

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

  async getTransactions(limit = 50, startAfter = null) {
    let query = this.db
      .collection('wallets')
      .doc(this.userId)
      .collection('transactions')
      .orderBy('timestamp', 'desc')
      .limit(limit);

    if (startAfter) {
      const startDoc = await this.db
        .collection('wallets')
        .doc(this.userId)
        .collection('transactions')
        .doc(startAfter)
        .get();

      if (startDoc.exists) {
        query = query.startAfter(startDoc);
      }
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}

export default Wallet;
