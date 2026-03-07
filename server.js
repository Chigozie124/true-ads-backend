import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import paymentRoutes from './routes/payment.js';
import escrowRoutes from './routes/escrow.js';
import userRoutes from './routes/user.js';
import walletRoutes from './routes/wallet.js';

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send('True Ads Backend Running');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'true-ads-backend',
    time: new Date().toISOString()
  });
});

app.use('/api/payment', paymentRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/user', userRoutes);
app.use('/api/wallet', walletRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`True Ads backend running on port ${PORT}`);
});

