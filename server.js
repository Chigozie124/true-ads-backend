// server.js - ES Module Version
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load env variables
dotenv.config();

// Import routes
import paymentRoutes from './routes/payment.js';
import escrowRoutes from './routes/escrow.js';
import withdrawRoutes from './routes/withdraw.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Use routes
app.use('/api/payment', paymentRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/withdraw', withdrawRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

