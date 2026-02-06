import express from "express";
import rateLimit from "./rate-limit.js";

import authRoutes from "./auth.routes.js";
import productRoutes from "./product.routes.js";
import orderRoutes from "./order.routes.js";
import disputeRoutes from "./dispute.routes.js";
import walletRoutes from "./wallet.routes.js";
import chatRoutes from "./chat.routes.js";
import adminRoutes from "./admin.routes.js";
import analyticsRoutes from "./analytics.routes.js";

const app = express();
app.use(express.json());
app.use(rateLimit);

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/orders", orderRoutes);
app.use("/disputes", disputeRoutes);
app.use("/wallet", walletRoutes);
app.use("/chat", chatRoutes);
app.use("/admin", adminRoutes);
app.use("/analytics", analyticsRoutes);

app.get("/", (_, res) => res.send("True Ads backend running"));

app.listen(process.env.PORT || 3000);
