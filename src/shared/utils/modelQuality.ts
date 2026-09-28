// Ranks retry fallbacks when health alone can't separate them. A hand-maintained tier list
// from public leaderboards, not a live lookup — a stale score only reorders, never excludes.

const QUALITY_TIERS: readonly (readonly [RegExp, number])[] = [
  // Non-chat models first: a name like "nemotron-…-embedding" must not match a chat tier above.
  [/embed|rerank|moderation|guard|whisper|tts|speech|ocr|schematron|safety/i, 5],

  // Frontier, 2026
  [/gpt-6/i, 99],
  [/claude-fable-5\.1|claude-5\.1-fable/i, 98],
  [/claude-opus-5/i, 98],
  [/claude-fable-5|claude-5-fable/i, 96],
  [/qwen3\.8-max/i, 96],
  [/glm-5\.3(?!-flash)/i, 95],
  [/grok-4\.6|grok-4\.5/i, 95],
  [/kimi-k3/i, 94],
  [/gemini-3\.8-pro|gemini-3-pro/i, 94],
  [/opus-4\.8|claude-opus-4/i, 93],

  // Strong and fast, 2026
  [/gpt-5\.6-(sol|luna)|gpt-5\.6/i, 92],
  [/deepseek-v4\.1|deepseek-v4/i, 91],
  [/gemini-3\.8-flash|gemini-3-flash/i, 90],
  [/glm-5\.3-flash/i, 89],
  [/mimo-v2/i, 88],
  [/hy4|hy3/i, 87],
  [/nemotron-3-ultra/i, 86],
  [/nex-n2\.5-pro/i, 85],
  [/laguna-s/i, 84],
  [/inkling(?!-small)/i, 83],
  [/nemotron-3-super/i, 82],
  [/ling-3\.0-flash/i, 80],
  [/nemotron-3\.5-lightning/i, 79],
  [/dots-3-note/i, 78],
  [/laguna-xs|nex-n2\.5-mini|inkling-small/i, 74],
  [/north-mini-code/i, 70],
  [/nemotron-3-nano/i, 68],

  // Earlier generations, still in use
  [/gpt-5(?!\.6)/i, 90],
  [/o3-pro/i, 88],
  [/claude-sonnet-4|claude-4|claude-3-7-sonnet|claude-3-5-sonnet/i, 86],
  [/gemini-2\.5-pro/i, 85],
  [/o3(?!-mini)|o1-pro/i, 85],
  [/deepseek-r1|deepseek-v3/i, 84],
  [/gpt-4\.1(?!-mini)(?!-nano)|gpt-4o(?!-mini)/i, 82],
  [/grok-2|grok-3|grok-4(?!\.)/i, 82],
  [/llama-4|llama-3\.1-405b|llama-3-405b/i, 80],
  [/qwen2\.5-72b|qwen-max|qwq/i, 78],
  [/mistral-large/i, 76],
  [/llama-3\.3-70b|llama-3\.1-70b|llama-3-70b/i, 75],
  [/command-r-plus/i, 72],
  [/gpt-4\.1-mini|gpt-4o-mini|o1-mini|o3-mini/i, 71],
  [/gemini-2\.0-flash|gemini-1\.5-flash/i, 69],
  [/mixtral-8x22b/i, 68],
  [/command-r(?!-plus)/i, 64],
  [/mixtral/i, 62],
  [/gpt-3\.5/i, 58],
  [/llama-3\.2|llama-3\.1-8b|llama-3-8b/i, 55],
  [/gemma-2|gemma/i, 52],
  [/phi-3|phi-4/i, 51],
  [/gpt-4\.1-nano|flash-lite|haiku/i, 48]
]

/** Neutral score for models absent from the tier list, so unknowns sort between good and bad. */
export const DEFAULT_MODEL_QUALITY_SCORE = 50

/** Rough 0-100 capability score for a model id; unknown ids get {@link DEFAULT_MODEL_QUALITY_SCORE}. */
export function getModelQualityScore(modelId: string): number {
  for (const [pattern, score] of QUALITY_TIERS) {
    if (pattern.test(modelId)) return score
  }
  return DEFAULT_MODEL_QUALITY_SCORE
}
