/**
 * Qwen3-Embedding last-token pooling.
 *
 * transformers.js feature-extraction only offers `mean` / `cls` / `none`
 * pooling, so callers request `none` (per-token embeddings) and pool the final
 * token here, then L2-normalize — matching Qwen3-Embedding's expected pooling.
 *
 * NOTE: this exact algorithm is also inlined in `inferenceWorkerSource.ts`,
 * because the worker runs as an eval'd string and cannot import project modules.
 * This module exists so the math stays unit-tested; keep the two copies in sync.
 */

export function l2normalize(vector: number[]): number[] {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  const norm = Math.sqrt(sumSquares)
  return norm === 0 ? vector : vector.map((value) => value / norm)
}

/** Pool per-token rows `[seq][hidden]` into the L2-normalized last-token vector. */
export function lastTokenPool(tokens: number[][]): number[] {
  return l2normalize(tokens[tokens.length - 1])
}
