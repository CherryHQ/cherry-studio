/**
 * Per-dialect vision-image token cost. When pixel dimensions are known (sharp read the
 * bytes) the provider's documented current-gen formula applies; otherwise a
 * documented-typical constant is used (URL images, or unreadable bytes).
 *
 * Model-version tweaks (Claude 4.7's 2576px cap, Gemini-3 `media_resolution`, gpt-4.1's
 * 32px-patch scheme) are intentionally omitted: the formula is keyed on the provider
 * endpoint's dialect, which can't distinguish model versions, and those tweaks are
 * second-order for a heuristic `count_tokens` estimate.
 */

/** Image pixel dimensions from `sharp().metadata()`. */
export interface ImageDims {
  width: number
  height: number
}

export type ImageTokensFn = (dims?: ImageDims) => number

/** Anthropic: `ceil(w·h / 750)` after clamping longest edge ≤1568px and ≤1.15 MP. */
export const anthropicImageTokens: ImageTokensFn = (dims) => {
  if (!dims) return 1590
  const { width, height } = clampToBudget(dims, 1568, 1_150_000)
  return Math.ceil((width * height) / 750)
}

/** OpenAI high-detail: `85 + 170·tiles`, tiles over 512px after fitting 2048² then shortest side 768. */
export const openaiImageTokens: ImageTokensFn = (dims) => {
  if (!dims) return 765
  const { width, height } = fitOpenAi(dims)
  const tiles = Math.ceil(width / 512) * Math.ceil(height / 512)
  return 85 + 170 * tiles
}

/** Gemini: `258` when both sides ≤384px, else `258` per 768² crop (crop unit = `floor(min/1.5)`). */
export const geminiImageTokens: ImageTokensFn = (dims) => {
  if (!dims) return 258
  const { width, height } = dims
  if (width <= 384 && height <= 384) return 258
  const crop = Math.max(1, Math.floor(Math.min(width, height) / 1.5))
  return 258 * Math.max(1, Math.ceil(width / crop)) * Math.max(1, Math.ceil(height / crop))
}

/** Ollama: no public per-pixel scheme → flat constant. */
export const ollamaImageTokens: ImageTokensFn = () => 1000

/** Scale down preserving aspect ratio so the longest edge ≤ maxEdge and total px ≤ maxPixels. */
function clampToBudget(dims: ImageDims, maxEdge: number, maxPixels: number): ImageDims {
  let { width, height } = dims
  const longest = Math.max(width, height)
  if (longest > maxEdge) {
    const scale = maxEdge / longest
    width *= scale
    height *= scale
  }
  const pixels = width * height
  if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels)
    width *= scale
    height *= scale
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
}

/** OpenAI high-detail fit: into a 2048² box, then shortest side down to 768px. */
function fitOpenAi(dims: ImageDims): ImageDims {
  let { width, height } = dims
  const longest = Math.max(width, height)
  if (longest > 2048) {
    const scale = 2048 / longest
    width *= scale
    height *= scale
  }
  const shortest = Math.min(width, height)
  if (shortest > 768) {
    const scale = 768 / shortest
    width *= scale
    height *= scale
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
}
