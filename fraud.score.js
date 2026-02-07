export function fraudScore(user, action) {
  let score = 0;

  if (user.isBanned) score += 100;
  if (action.amount > 500000) score += 30;
  if (user.failedPayments > 3) score += 20;

  return score; // >70 = block
}
