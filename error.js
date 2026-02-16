export default function ESCROW_ERROR(err, req, res, next) {
  console.error(err);
  res.status(500).json({ error: "ESCROW internal error" });
}
