import cron from "node-cron";
import { ESCROW_DB, ESCROW_FIELD } from "./firebase.js";

cron.schedule("0 * * * *", async () => {
  try {
    const snapshot = await ESCROW_DB.collection("ESCROW")
      .where("status", "==", "FUNDED")
      .get();

    for (const doc of snapshot.docs) {
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
    }

    console.log(`✅ Cron job completed at ${new Date().toISOString()}`);
  } catch (err) {
    console.error("❌ Cron job error:", err);
  }
});
