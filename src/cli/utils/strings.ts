/**
 * Levenshtein distance between two strings.
 * Used for "did you mean?" suggestions.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * Suggest the closest match from a list of candidates.
 * Returns null if no candidate is within maxDistance.
 */
export function suggestClosest(input: string, candidates: readonly string[], maxDistance = 2): string | null {
  let best: { name: string; dist: number } | null = null;
  for (const candidate of candidates) {
    const dist = levenshtein(input, candidate);
    if (dist <= maxDistance && (!best || dist < best.dist)) {
      best = { name: candidate, dist };
    }
  }
  return best ? best.name : null;
}
