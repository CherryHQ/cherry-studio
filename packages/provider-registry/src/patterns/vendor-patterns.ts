/**
 * Vendor identity regex patterns — the single source of truth for
 * "which vendor does this raw model ID belong to".
 *
 * Shared across three call sites:
 *  - `@shared/utils/model` — vendor check functions (`isAnthropicModel`
 *    etc.) and capability inference (e.g. deciding which IDs to mark
 *    `REASONING` in the schema).
 *  - `@cherrystudio/ui` icon registry — vendor-level icon routing for
 *    models whose ID doesn't have a dedicated SKU icon.
 *  - Future callers doing vendor dispatch.
 *
 * Keeping these regex in the registry layer means both capability
 * inference and icon lookup stay in lockstep when a new vendor /
 * naming convention lands.
 *
 * Scope: **vendor identity only**. SKU-level patterns (`gpt-5.1-codex-mini`,
 * `claude-sonnet-4-6`, etc.) stay in their specific consumer modules —
 * those are dispatch details rather than shared vendor taxonomy.
 *
 * Normalization note: patterns assume the id has already been lowercased
 * and had the leading namespace stripped (e.g. `deepseek/deepseek-r1` →
 * `deepseek-r1`). Pair with `getLowerBaseModelName` (in `@shared`) or
 * `normalizeModelId` (in this package).
 */

/**
 * Match raw model IDs to their vendor. Keys are vendor slugs; order is
 * not significant because every pattern is anchored to the start of the
 * (namespace-stripped) id, so they stay mutually exclusive — a model
 * belongs to at most one vendor. Keep new patterns anchored (`^…`) so a
 * cross-vendor id like `deepseek-grok` resolves by its leading token, not
 * by insertion order.
 */
export const VENDOR_PATTERNS = {
  /** Anthropic / Claude family. Also matches the AWS Bedrock `anthropic.claude-*` prefix. */
  anthropic: /^(?:anthropic\.)?claude/i,

  /** Google Gemini family. */
  gemini: /^(?:gemini|palm|veo|imagen|learnlm|lyria)/i,

  /** Google Gemma family (gemma-*, gemma2/3/4, and the Ollama-style `gemma:2b` tag). */
  gemma: /^gemma(?:[-:\d]|$)/i,

  /** xAI Grok family. */
  grok: /^grok/i,

  /**
   * OpenAI (chat + reasoning + legacy + media + embeddings). GPT-n, ChatGPT, the bare o<digit> series,
   * codex/davinci/babbage, DALL·E, moderation, and OpenAI's `text-embedding-3*` / `-ada` embeddings.
   * `text-embedding` is scoped to the `-3`/`-ada` SKUs on purpose — bare `text-embedding-0xx` is Google's,
   * and `VENDOR_PATTERNS` is a flat set with no per-creator disambiguation.
   */
  openai: /\bgpt\b|^o[134]|^chatgpt|^codex|^davinci|^babbage|^dall-e|^text-moderation|^text-embedding-(?:3|ada)/i,

  /** Alibaba Qwen family (qwen, qwq, qvq). */
  qwen: /^qwen|^qwq|^qvq|^tongyi/i,

  /** ByteDance Doubao family. */
  doubao: /^(?:doubao|skylark|seed|seedance|seedream|ep-)/i,

  /** Tencent Hunyuan family — `hunyuan-*`, the `hy-*` SKUs, and the versioned `hyN` namespace (`hy3-preview`). */
  hunyuan: /^(?:hunyuan|hy-|hy\d)/i,

  /** Moonshot / Kimi family. */
  kimi: /^(?:kimi|moonshot)/i,

  /** DeepSeek family. */
  deepseek: /^deepseek/i,

  /** Perplexity (sonar family). */
  perplexity: /^sonar/i,

  /** Baichuan family. */
  baichuan: /^baichuan/i,

  /** Xiaomi MiMo family. */
  mimo: /^mimo-/i,

  /** Ant Group Ling / Ring family. */
  ling: /^(?:ling|ring)-/i,

  /** MiniMax family — current `minimax-*` plus the legacy `abab-*` SKUs the creator still claims. */
  minimax: /^(?:minimax|abab)/i,

  /** StepFun family. */
  step: /^step-/i,

  /** Zhipu / GLM family. */
  zhipu: /^(?:glm|chatglm|cogview|cogvideo|codegeex)/i,

  /** Mistral family — incl. the `open-*` open-weight line (`open-mistral-7b`, `open-mixtral-8x22b`) and `labs-*`. */
  mistral: /^(?:open-|labs-)?(?:mistral|pixtral|codestral|ministral|voxtral|devstral|mixtral|magistral)/i
} as const satisfies Record<string, RegExp>

export type VendorKey = keyof typeof VENDOR_PATTERNS

/**
 * Return the vendor slug for a normalized model ID, or `undefined` if
 * no vendor pattern matches. Iteration order is stable (key insertion
 * order) but not semantically important — patterns don't overlap.
 */
export function matchVendor(normalizedId: string): VendorKey | undefined {
  for (const [vendor, pattern] of Object.entries(VENDOR_PATTERNS) as [VendorKey, RegExp][]) {
    if (pattern.test(normalizedId)) return vendor
  }
  return undefined
}

/**
 * Lightweight vendor predicate factory. Exported primarily so consumers
 * can spell the check as `isVendor('anthropic')(id)` when composing
 * higher-level logic.
 */
export function isVendor(vendor: VendorKey): (normalizedId: string) => boolean {
  const pattern = VENDOR_PATTERNS[vendor]
  return (id: string) => pattern.test(id)
}
