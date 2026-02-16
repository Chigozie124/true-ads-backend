import cron from "node-cron";
import { ESCROW_DB, ESCROW_FIELD } from "./firebase.js";

cron.schedule("0 * * * *", async () => {
  const snapshot = await ESCROW_DB.collection("ESCROW")
    .where("status", "==", "FUNDED")
    .get();

  snapshot.forEach(async (doc) => {
    const escrow = doc.data();
    const fiveDays = 5 * 24 * 60 * 60 * 1000;

    if (Date.now() - escrow.fundedAt > fiveDays) {
      await doc.ref.update({ status: "RELEASED" });

      await ESCROW_DB.collection("ESCROW_USER")
        .doc(escrow.sellerId)
        .update({
          balance: ESCROW_FIELD.increment(escrow.amount)
        });
    }
  });
});
