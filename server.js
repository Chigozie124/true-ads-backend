import "dotenv/config";
import express from "express";
import cors from "cors";

import "./firebase.js"; // init firebase
import "./cron.js";     // start cron (non blocking)

const app = express();

app.use(cors());
app.use(express.json());

/* ===== ROOT ===== */
app.get("/", (req, res) => {
  res.status(200).json({
    name: "ESCROW",
    status: "running"
  });
});

/* ===== HEALTH ===== */
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* ===== PORT ===== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 SERVER STARTED ON PORT", PORT);
});
