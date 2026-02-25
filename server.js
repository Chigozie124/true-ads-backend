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

/* ===== MIDDLEWARE ===== */

app.use(cors());
app.use(express.json());
app.use(ESCROW_RATE);

/* ===== HEALTH CHECK (VERY IMPORTANT FOR RAILWAY) ===== */

app.get("/", (req, res) => {
  res.status(200).send("ESCROW SERVER RUNNING");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    version: ESCROW_VERSION
  });
});

/* ===== ROUTES ===== */

app.use("/escrow", ESCROW_MAIN);
app.use("/escrow/dispute", ESCROW_DISPUTE);
app.use("/escrow/withdraw", ESCROW_WITHDRAW);
app.use("/escrow/admin", ESCROW_ADMIN);

app.post("/escrow/webhook/paystack", ESCROW_WEBHOOK);

app.use(ESCROW_ERROR);

/* ===== START SERVER ===== */

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 ESCROW SERVER STARTED ON PORT", PORT);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
