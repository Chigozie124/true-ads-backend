export function ESCROW_FRAUD_SCORE(amount) {
  let score = 0;
  if (amount > 500000) score += 40;
  return score;
}
