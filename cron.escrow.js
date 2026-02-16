import cron from "node-cron";
import { db } from "./firebaseAdmin.js";

cron.schedule("0 * * * *", async () => {
  const snap = await db
    .collection("escrows")
    .where("status", "==", "funded")
    .get();

  snap.forEach(async (doc) => {
    await doc.ref.update({ status: "released" });
  });
});
