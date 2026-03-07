import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// Import routes
import paymentRoutes from './routes/payment.js';
import escrowRoutes from './routes/escrow.js';
import withdrawRoutes from './routes/withdraw.js';
import userRoutes from './routes/user.js';
import walletRoutes from './routes/wallet.js';

const app = express();

/* -------------------- Middleware -------------------- */

// CORS - Allow all origins with credentials
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Parse JSON body
app.use(express.json());

/* -------------------- Routes -------------------- */

app.get('/', (req, res) => {
    res.send('True Ads Backend Running');
});

app.use('/api/payment', paymentRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/withdraw', withdrawRoutes);
app.use('/api/user', userRoutes);
app.use('/api/wallet', walletRoutes);

/* -------------------- Health Check -------------------- */

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        service: 'true-ads-backend',
        time: new Date().toISOString()
    });
});

/* -------------------- Start Server -------------------- */

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
});

