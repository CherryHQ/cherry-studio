/**
 * L2 normalization for builtin local embedding vectors (Qwen3-Embedding and Harrier 270M).
 *
 * transformers.js feature-extraction only offers `mean` / `cls` / `none`
 * pooling, so the embedding entry requests `none` (per-token embeddings), takes
 * the final token, and L2-normalizes it — matching Qwen3-Embedding's expected
 * pooling. Harrier's graph already returns L2-normalized `sentence_embedding`;
 * re-normalizing it here is idempotent and keeps both paths unit-length.
 */
export function l2normalize(vector: number[]): number[] {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  const norm = Math.sqrt(sumSquares)
  return norm === 0 ? vector : vector.map((value) => value / norm)
}
