import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { validateEnv } from "./env.js";
validateEnv();

/* ===== INIT CORE ===== */
import "./firebase.js";
import "./cron.js"; // all cron jobs start automatically

/* ===== MIDDLEWARE ===== */
import ESCROW_RATE from "./rate.js";
import ESCROW_ERROR from "./error.js";

/* ===== ROUTES ===== */
import ESCROW_MAIN from "./escrow.js";
import ESCROW_DISPUTE from "./dispute.js";
import ESCROW_WITHDRAW from "./withdraw.js";
import ESCROW_ADMIN from "./admin.js";
import ESCROW_WEBHOOK from "./webhook.js";

/* ===== USER / APP ROUTES ===== */
import USER_ROUTES from "./user.js";
import WALLET_ROUTES from "./wallet.js";
import PRODUCT_ROUTES from "./products.js";
import TRANSACTION_ROUTES from "./transactions.js";

/* ===== VERSION ===== */
import { ESCROW_VERSION } from "./version.js";

const app = express();

/* ==============================
   SECURITY
============================== */
app.use(helmet());

app.use(cors({
  origin: "*", // change to frontend domain later
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json({
  limit: "10mb",
  verify: (req, res, buf) => {
    req.rawBody = buf?.toString();
  }
}));

app.use(ESCROW_RATE);

/* ==============================
   DEBUG
============================== */
console.log("Railway PORT:", process.env.PORT);
console.log("BASE_URL:", process.env.BASE_URL);

/* ==============================
   HEALTH CHECK
============================== */
app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/", (req, res) => {
  res.json({
    name: "ESCROW",
    version: ESCROW_VERSION,
    status: "stable",
    uptime: process.uptime()
  });
});

/* ==============================
   SESSION CHECK
============================== */
app.get("/session", (req, res) => {
  res.json({ status: "active" });
});

/* ==============================
   USER APP ROUTES
============================== */
app.use("/user", USER_ROUTES);
app.use("/wallet", WALLET_ROUTES);
app.use("/products", PRODUCT_ROUTES);
app.use("/transactions", TRANSACTION_ROUTES);

/* ==============================
   ESCROW ROUTES
============================== */
app.use("/escrow", ESCROW_MAIN);
app.use("/escrow/dispute", ESCROW_DISPUTE);
app.use("/escrow/withdraw", ESCROW_WITHDRAW);
app.use("/escrow/admin", ESCROW_ADMIN);

/* ==============================
   PAYSTACK WEBHOOK
============================== */
app.post("/escrow/webhook/paystack", ESCROW_WEBHOOK);

/* ==============================
   ERROR HANDLER
============================== */
app.use(ESCROW_ERROR);

/* ==============================
   START SERVER
============================== */
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ ESCROW v${ESCROW_VERSION} running on port ${PORT}`);
});

/* ==============================
   KEEP ALIVE
============================== */
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
