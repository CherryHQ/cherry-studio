/**
 * Image-generation capability heuristics — ingest-time only (custom-model
 * creation, catalog enrichment). Mirrors legacy DEDICATED_IMAGE_MODELS regex
 * `gpt-<version>-image` from PR #15684.
 */
const IMAGE_GENERATION_PATTERNS: readonly RegExp[] = [
  /^gpt-\d+(?:[.-]\d+)*-image(?:-[\w-]+)?$/i,
  /^gpt-image(?:-[\w-]+)?$/i,
  /^dall-e(?:-[\w-]+)?$/i
]

export function isImageGenerationId(rawModelId: string): boolean {
  const base = rawModelId.split('/').pop() ?? rawModelId
  const lower = base.toLowerCase()
  return IMAGE_GENERATION_PATTERNS.some((re) => re.test(lower))
}
