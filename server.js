import "dotenv/config";
import express from "express";
import cors from "cors";

import { validateEnv } from "./env.js";
validateEnv();

import "./firebase.js";
import "./cron.js";

import ESCROW_RATE from "./rate.js";
import ESCROW_ERROR from "./error.js";

import ESCROW_MAIN from "./escrow.js";
import ESCROW_DISPUTE from "./dispute.js";
import ESCROW_WITHDRAW from "./withdraw.js";
import ESCROW_ADMIN from "./admin.js";
import ESCROW_WEBHOOK from "./webhook.js";

import { ESCROW_VERSION } from "./version.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(ESCROW_RATE);

/* ===== ROUTES ===== */

app.get("/", (req, res) => {
  res.json({
    name: "ESCROW",
    version: ESCROW_VERSION,
    status: "stable",
  });
});

app.use("/escrow", ESCROW_MAIN);
app.use("/escrow/dispute", ESCROW_DISPUTE);
app.use("/escrow/withdraw", ESCROW_WITHDRAW);
app.use("/escrow/admin", ESCROW_ADMIN);

app.post("/escrow/webhook/paystack", ESCROW_WEBHOOK);

app.use(ESCROW_ERROR);

/* ===== START SERVER ===== */

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`ESCROW v${ESCROW_VERSION} running on ${PORT}`);
});

/* Railway keep alive protection */
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
