export function calculateBackoffSeconds(base, attempts) {
  const numericBase = Number(base);
  const numericAttempts = Number(attempts);

  if (!Number.isFinite(numericBase) || numericBase < 1) {
    throw new Error('Backoff base must be a number greater than or equal to 1');
  }

  if (!Number.isInteger(numericAttempts) || numericAttempts < 1) {
    throw new Error('Attempts must be a positive integer');
  }

  return Math.pow(numericBase, numericAttempts);
}
