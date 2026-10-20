/**
 * L2 normalization for Qwen3-Embedding vectors.
 *
 * transformers.js feature-extraction only offers `mean` / `cls` / `none`
 * pooling, so the embedding entry requests `none` (per-token embeddings), takes
 * the final token, and L2-normalizes it — matching Qwen3-Embedding's expected
 * pooling.
 */
export function l2normalize(vector: number[]): number[] {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  const norm = Math.sqrt(sumSquares)
  return norm === 0 ? vector : vector.map((value) => value / norm)
}
