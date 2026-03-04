// models/Wallet.js
const admin = require('firebase-admin');

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

    // Create escrow record
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
      // Release from buyer's escrow
      t.update(buyerWalletRef, {
        escrowed: admin.firestore.FieldValue.increment(-parseFloat(amount)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Credit seller
      t.update(sellerWalletRef, {
        balance: admin.firestore.FieldValue.increment(parseFloat(amount)),
        totalEarned: admin.firestore.FieldValue.increment(parseFloat(amount)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

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
        releasedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Log seller transaction
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

module.exports = Wallet;

