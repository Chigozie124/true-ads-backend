import cron from "node-cron";
import { db, FieldValue } from "./firebase.js";

/*
  AUTO RELEASE ESCROW
  Runs every hour
  Releases escrow after 5 days if still FUNDED
*/

cron.schedule("0 * * * *", () => {
  (async () => {
    try {
      console.log("⏳ Running escrow auto-release cron...");

      const snapshot = await db
        .collection("ESCROW")
        .where("status", "==", "FUNDED")
        .get();

      if (snapshot.empty) {
        console.log("No funded escrows found.");
        return;
      }

      const fiveDays = 5 * 24 * 60 * 60 * 1000;
      const now = Date.now();

      for (const doc of snapshot.docs) {
        const escrow = doc.data();

        if (!escrow.fundedAt) continue;

        if (now - escrow.fundedAt > fiveDays) {

          // 1️⃣ Update escrow status
          await doc.ref.update({
            status: "RELEASED",
            releasedAt: now
          });

          // 2️⃣ Credit seller wallet
          await db
            .collection("ESCROW_USER")
            .doc(escrow.sellerId)
            .update({
              balance: FieldValue.increment(escrow.amount)
            });

          console.log(`✅ Escrow ${doc.id} auto-released`);
        }
      }

      console.log("✅ Cron job completed successfully");

    } catch (err) {
      console.error("❌ Cron job error:", err);
    }
  })();
});
