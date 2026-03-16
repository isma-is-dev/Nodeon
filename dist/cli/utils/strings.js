export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  let j = 0;
  while (j <= n) {
    dp[j] = j;
    j = j + 1;
  }
  let i = 1;
  while (i <= m) {
    let prev = dp[0];
    dp[0] = i;
    let jj = 1;
    while (jj <= n) {
      const temp = dp[jj];
      dp[jj] = Math.min(dp[jj] + 1, dp[jj - 1] + 1, prev + a[i - 1] === b[jj - 1] ? 0 : 1);
      prev = temp;
      jj = jj + 1;
    }
    i = i + 1;
  }
  return dp[n];
}
export function suggestClosest(input, candidates, maxDistance) {
  const maxDist = maxDistance ?? 2;
  let best = null;
  for (const candidate of candidates) {
    const dist = levenshtein(input, candidate);
    if (dist <= maxDist && (!best || dist < best.dist)) {
      best = { name: candidate, dist: dist };
    }
  }
  return best ? best.name : null;
}