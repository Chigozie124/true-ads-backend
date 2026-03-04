import express from "express";
import { db } from "./firebase.js";

const router = express.Router();

router.get("/overview", async (_, res) => {
  const users = (await db.collection("users").get()).size;
  const orders = (await db.collection("orders").get()).size;
  res.json({ users, orders });
});

export default router;
