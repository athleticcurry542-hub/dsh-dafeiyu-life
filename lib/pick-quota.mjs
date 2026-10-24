/**
 * Compute the number of newly picked videos allowed in a run.
 * Daily quota applies across all runs; per-run quota applies to each run.
 * Existing configs without `pickPerRound` default to five per run.
 */
export function picksThisRound(perDay, pickPerRound, alreadyPicked = 0) {
  const daily = Math.max(0, Math.floor(Number(perDay) || 0))
  const round = Math.max(1, Math.min(50, Math.floor(Number(pickPerRound) || 5)))
  const picked = Math.max(0, Math.floor(Number(alreadyPicked) || 0))
  return Math.max(0, Math.min(round, daily - picked))
}
