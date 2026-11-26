const KNOWN_MODEL_CONTEXT_WINDOWS: ReadonlyArray<[RegExp, number]> = [
  [/^gemini-2\.(?:0|5)|^gemini-3|^gemini-4/i, 1_048_576],
  [/^claude-(?:opus|sonnet|haiku)-(?:3[.-]7|4(?:[.-]\d+)?|5(?:[.-]\d+)?)/i, 200_000],
  [/^gpt-5(?:\.\d+)?(?:-codex)?/i, 400_000],
  [/^codex-mini|^o[34](?:-mini|-pro)?\b/i, 200_000],
  [/^gpt-4\.1(?:-mini|-nano)?\b/i, 1_047_576],
  [/^gpt-4o(?:-mini)?\b/i, 128_000]
]

/**
 * Resolve a context window in tokens for a local agent model, preferring any
 * runtime-declared value and falling back only to known model families.
 */
export function resolveLocalModelContextWindow(
  modelId: string | null | undefined,
  declaredWindow?: number | null
): number | undefined {
  if (typeof declaredWindow === 'number' && Number.isFinite(declaredWindow) && declaredWindow > 0) {
    return Math.trunc(declaredWindow)
  }
  const trimmed = modelId?.trim()
  if (!trimmed) return undefined
  if (/\[1m\]$/i.test(trimmed)) return 1_000_000
  const normalized = trimmed.replace(/\[1m\]$/i, '')
  const baseModel = normalized.split(/[/:]/).at(-1)?.trim() || normalized
  for (const [pattern, windowTokens] of KNOWN_MODEL_CONTEXT_WINDOWS) {
    if (pattern.test(baseModel)) return windowTokens
  }
  return undefined
}
