import { db } from "../firebaseAdmin.js";

export default async function (req, res) {
  const event = req.body;

  if (event.event === "charge.success") {
    const ref = event.data.reference;

    const escrowRef = db.collection("escrows").doc(ref);
    const escrow = await escrowRef.get();

    if (escrow.exists) {
      await escrowRef.update({ status: "funded" });
    }
  }

  res.sendStatus(200);
}
