import crypto from "crypto";
import { ESCROW_DB } from "./firebase.js";

export default async function ESCROW_WEBHOOK(req, res) {
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    return res.status(401).send("Invalid signature");
  }

  const event = req.body;

  if (event.event === "charge.success") {
    const escrowId = event.data.reference;

    await ESCROW_DB.collection("ESCROW")
      .doc(escrowId)
      .update({
        status: "FUNDED",
        fundedAt: Date.now()
      });
  }

  res.sendStatus(200);
}
