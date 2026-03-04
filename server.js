// server.js - Add these lines
const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Import routes
const paymentRoutes = require('./routes/payment');
const escrowRoutes = require('./routes/escrow');
// Your existing routes...
const withdrawRoutes = require('./routes/withdraw'); // Your existing

// Use routes
app.use('/api/payment', paymentRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/withdraw', withdrawRoutes); // Your existing

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

