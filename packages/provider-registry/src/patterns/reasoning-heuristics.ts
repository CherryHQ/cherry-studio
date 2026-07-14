/**
 * Reasoning-control heuristics — ID-pattern knowledge compiled from the legacy
 * runtime tables (`THINKING_TOKEN_MAP` + the renderer's 37-family
 * `MODEL_SUPPORTED_REASONING_EFFORT`), expressed as `ReasoningControl`
 * declarations. The SINGLE copy of this knowledge (#16598).
 *
 * Consumed at INGEST time only — never as a runtime capability source:
 *  - `generate-catalog.ts` fills catalog models that have the `reasoning`
 *    capability but no models.dev `reasoning_options` block;
 *  - `ModelService` infers controls when a custom-provider model row is
 *    created (or read) without a descriptor;
 *  - `@shared/utils/model.findTokenLimit` delegates its token-limit table
 *    here during the migration (deleted once runtime consumers read the
 *    descriptor).
 *
 * Vocabularies are the models' NATIVE option sets (what the target API
 * accepts verbatim), not the legacy UI compromises — e.g. Claude 4.6's top
 * tier is `max`, DeepSeek V4's native pair is `high`/`max`.
 *
 * Patterns test the lowercased, namespace-stripped id (`baseName`); keep
 * SKU-specific rules before generic family rules — first match wins.
 */
import type { ReasoningEffort } from '../schemas/enums'
import type { ReasoningControl } from '../schemas/model'

interface EffortRule {
  pattern: RegExp
  /** Native discrete vocabulary (omit for budget/toggle-only families). */
  values?: ReasoningEffort[]
  /** Model exposes an on/off switch for thinking. */
  toggle?: boolean
}

/**
 * Family → native effort vocabulary / toggle. Ordered: first match wins.
 */
const EFFORT_RULES: EffortRule[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  { pattern: /^(?:o\d|gpt).*deep[-_]?research/i, values: ['medium'] },
  { pattern: /^gpt-5\.1-codex-max/i, values: ['medium', 'high', 'xhigh'] },
  { pattern: /^gpt-5\.1-codex/i, values: ['medium', 'high'] },
  { pattern: /^gpt-5\.1/i, values: ['none', 'low', 'medium', 'high'] },
  { pattern: /^gpt-5-pro/i, values: ['high'] },
  { pattern: /^gpt-5\.\d+-pro/i, values: ['medium', 'high', 'xhigh'] },
  { pattern: /^gpt-5-codex/i, values: ['low', 'medium', 'high'] },
  { pattern: /^gpt-5\.\d+-codex/i, values: ['low', 'medium', 'high', 'xhigh'] },
  // gpt-5.2 and later minor versions (5.3+ inherit the 5.2 vocabulary)
  { pattern: /^gpt-5\.\d+(?!.*chat)/i, values: ['none', 'low', 'medium', 'high', 'xhigh'] },
  { pattern: /^gpt-5(?![.\d])(?!.*chat)/i, values: ['minimal', 'low', 'medium', 'high'] },
  { pattern: /^gpt-oss/i, values: ['low', 'medium', 'high'] },
  // o-series reasoning SKUs (o1/o3/o4, excluding the non-reasoning previews)
  { pattern: /^o1(?!-preview|-mini)|^o3|^o4/i, values: ['low', 'medium', 'high'] },

  // ── Anthropic / Claude ────────────────────────────────────────────────────
  // 4.6/4.7 adaptive-effort series (models.dev normally covers these; the rule
  // backstops gap SKUs like dated snapshots).
  {
    pattern: /^(?:anthropic\.)?claude-(?:opus|sonnet)-4[.-][67]/i,
    values: ['low', 'medium', 'high', 'max'],
    toggle: true
  },
  // Pre-adaptive thinking SKUs: on/off + budget (budget from TOKEN_LIMIT_RULES).
  { pattern: /^(?:anthropic\.)?claude/i, toggle: true },

  // ── xAI Grok ──────────────────────────────────────────────────────────────
  { pattern: /^grok-4\.3(?!.*non-reasoning)/i, values: ['none', 'low', 'medium', 'high'] },
  // grok-4-fast's on/off knob exists ONLY on OpenRouter's rebroadcast (the
  // request path special-cases it by SKU); the native xAI route has no knob,
  // so no rule here — a synthesized vocabulary would leak an unsupported
  // reasoningEffort onto the native adapter.
  { pattern: /^grok-3-mini/i, values: ['low', 'high'] },

  // ── Google Gemini / Gemma ─────────────────────────────────────────────────
  { pattern: /^gemma-?4/i, values: ['minimal', 'high'] },
  {
    pattern: /^gemini-3(?:\.\d+)?-flash|^gemini-3\.1-flash-lite|^gemini-flash-latest/i,
    values: ['minimal', 'low', 'medium', 'high']
  },
  { pattern: /^gemini-3-pro/i, values: ['low', 'high'] },
  { pattern: /^gemini-3\.\d+-pro|^gemini-pro-latest/i, values: ['low', 'medium', 'high'] },
  // Gemini 2.x budget models: flash can be turned off (budget 0), pro cannot.
  { pattern: /^gemini-[\d.]+.*flash/i, toggle: true },
  { pattern: /^gemini-[\d.]+.*pro/i },

  // ── Alibaba Qwen ──────────────────────────────────────────────────────────
  // Always-think SKUs: no toggle, no 'none' — budget only.
  { pattern: /^qwen3(?:-vl)?-.*thinking/i },
  // QwQ/QVQ are always-reasoning previews with no knob beyond the budget.
  { pattern: /^qwq|^qvq/i },
  { pattern: /^qwen/i, toggle: true },

  // ── ByteDance Doubao ──────────────────────────────────────────────────────
  {
    pattern: /doubao-seed-1-6-(?:lite-)?251015|doubao-seed-2[.-]0|doubao-seed-1[.-]8/i,
    values: ['minimal', 'low', 'medium', 'high']
  },
  // Auto-capable SKUs (mirrors DOUBAO_THINKING_AUTO_MODEL_REGEX).
  {
    pattern: /doubao-(1-5-thinking-pro-m|seed-1[.-]6)(?!-(?:flash|thinking)(?:-|$))(?:-lite)?(?!-251015)(?:-\d+)?$/i,
    values: ['none', 'auto', 'high']
  },
  // Remaining thinking SKUs: on/off only (mirrors DOUBAO_THINKING_MODEL_REGEX).
  {
    pattern:
      /doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-thinking(?:-|$))|seed-code(?:-preview)?(?:-\d+)?|seed-2[.-]0(?:-[\w-]+)?)(?:-[\w-]+)*/i,
    values: ['none', 'high']
  },

  // ── Other vendors ─────────────────────────────────────────────────────────
  { pattern: /^hunyuan-a13b/i, toggle: true },
  { pattern: /glm-?5|glm-4\.[567]/i, toggle: true },
  { pattern: /mimo-v2\.5(?:-pro)?(?!-)|mimo-v2-(?:flash|pro|omni)/i, toggle: true },
  // Kimi K2.5+/K3+ expose the thinking toggle; kimi-k2-thinking is always-on.
  { pattern: /^kimi-k(?:2\.[5-9]\d*|[3-9]\d*(?:\.\d+)?)/i, toggle: true },
  { pattern: /^sonar-reasoning|^sonar-deep-research/i, values: ['low', 'medium', 'high'] },
  { pattern: /^deepseek-v(?:[4-9]\d*|[1-9]\d{1,})(?:\.\d+)?/i, values: ['none', 'high', 'max'] },
  // DeepSeek v3.x hybrid inference (thinking / non-thinking at one endpoint).
  { pattern: /deepseek-(?:chat|v3(?:\.\d|-\d))/i, toggle: true },
  { pattern: /^mistral-small-2603/i, values: ['none', 'high'] }
]

/**
 * Thinking-token budget ranges — verbatim port of the legacy runtime
 * `THINKING_TOKEN_MAP` (shared/utils/model.ts), which delegates here during
 * the migration. First match wins; patterns are unanchored on purpose
 * (ids may arrive as `provider::model` unique ids).
 */
const TOKEN_LIMIT_RULES: Array<{ pattern: RegExp; min: number; max: number }> = [
  { pattern: /gemini-2\.5-flash-lite.*$/i, min: 512, max: 24_576 },
  // Gemini -latest aliases (point at the current Gemini 3 flagships).
  { pattern: /gemini-flash-lite-latest$/i, min: 512, max: 24_576 },
  { pattern: /gemini-flash-latest$/i, min: 0, max: 24_576 },
  { pattern: /gemini-pro-latest$/i, min: 128, max: 32_768 },
  { pattern: /gemini-.*-flash.*$/i, min: 0, max: 24_576 },
  { pattern: /gemini-.*-pro.*$/i, min: 128, max: 32_768 },
  { pattern: /qwen3-235b-a22b-thinking-2507$/i, min: 0, max: 81_920 },
  { pattern: /qwen3-30b-a3b-thinking-2507$/i, min: 0, max: 81_920 },
  { pattern: /qwen3-vl-235b-a22b-thinking$/i, min: 0, max: 81_920 },
  { pattern: /qwen3-vl-30b-a3b-thinking$/i, min: 0, max: 81_920 },
  { pattern: /qwen-plus-2025-07-14$/i, min: 0, max: 38_912 },
  { pattern: /qwen-plus-2025-04-28$/i, min: 0, max: 38_912 },
  { pattern: /qwen3-1\.7b$/i, min: 0, max: 30_720 },
  { pattern: /qwen3-0\.6b$/i, min: 0, max: 30_720 },
  { pattern: /qwen-plus.*$/i, min: 0, max: 81_920 },
  { pattern: /qwen-turbo.*$/i, min: 0, max: 38_912 },
  { pattern: /qwen-flash.*$/i, min: 0, max: 81_920 },
  { pattern: /qwen3-max(-.*)?$/i, min: 0, max: 81_920 },
  // `qwen-max-latest` is a distinct alias — the versioned `qwen-max-2025-09-23`
  // is explicitly excluded because that SKU predates thinking-token support.
  { pattern: /qwen-max-latest$/i, min: 0, max: 81_920 },
  { pattern: /^qwen3\.[5-9]/i, min: 0, max: 81_920 },
  { pattern: /qwen3-(?!max).*$/i, min: 1024, max: 38_912 },
  { pattern: /(?:anthropic\.)?claude-opus-4[.-]7(?:[@\-:][\w\-:]+)?$/i, min: 1024, max: 128_000 },
  { pattern: /(?:anthropic\.)?claude-opus-4[.-]6(?:[@\-:][\w\-:]+)?$/i, min: 1024, max: 128_000 },
  { pattern: /(?:anthropic\.)?claude-(:?sonnet|haiku)-4[.-]6.*(?:-v\d+:\d+)?$/i, min: 1024, max: 64_000 },
  { pattern: /(?:anthropic\.)?claude-(:?haiku|sonnet|opus)-4[.-]5.*(?:-v\d+:\d+)?$/i, min: 1024, max: 64_000 },
  { pattern: /(?:anthropic\.)?claude-opus-4[.-]1.*(?:-v\d+:\d+)?$/i, min: 1024, max: 32_000 },
  {
    pattern: /(?:anthropic\.)?claude-sonnet-4(?:[.-]0)?(?:[@-](?:\d{4,}|[a-z][\w-]*))?(?:-v\d+:\d+)?$/i,
    min: 1024,
    max: 64_000
  },
  {
    pattern: /(?:anthropic\.)?claude-opus-4(?:[.-]0)?(?:[@-](?:\d{4,}|[a-z][\w-]*))?(?:-v\d+:\d+)?$/i,
    min: 1024,
    max: 32_000
  },
  { pattern: /(?:anthropic\.)?claude-3[.-]7.*sonnet.*(?:-v\d+:\d+)?$/i, min: 1024, max: 64_000 },
  { pattern: /baichuan-m2$/i, min: 0, max: 30_000 },
  { pattern: /baichuan-m3$/i, min: 0, max: 30_000 },
  { pattern: /gemma-?4[:-]?e[24]b/i, min: 1024, max: 8192 },
  { pattern: /gemma-?4[:-]?26b/i, min: 1024, max: 30_720 },
  { pattern: /gemma-?4[:-]?31b/i, min: 1024, max: 30_720 },
  // Hunyuan — only hunyuan-a13b exposes the knob today.
  { pattern: /hunyuan-a13b/i, min: 0, max: 30_720 },
  // Zhipu / GLM — GLM-5 and GLM-4.5 / 4.6 / 4.7. Unanchored to handle
  // provider-prefixed ids (zhipu/glm-4.6, fireworks normalized form).
  { pattern: /glm-?5|glm-4\.[567]/i, min: 0, max: 30_720 },
  // MiMo v2 family.
  { pattern: /mimo-v2\.5(?:-pro)?(?!-)/i, min: 0, max: 30_720 },
  { pattern: /mimo-v2-(?:flash|pro|omni)/i, min: 0, max: 30_720 },
  // Kimi K2.5+ / K3+.
  { pattern: /kimi-k(?:2\.[5-9]\d*|[3-9]\d*(?:\.\d+)?)/i, min: 0, max: 30_720 },
  // Doubao thinking SKUs (mirrors DOUBAO_THINKING_MODEL_REGEX scope).
  // The `(?!-thinking(?:-|$))` lookahead excludes always-thinking seed variants.
  {
    pattern:
      /doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-thinking(?:-|$))|seed-code(?:-preview)?(?:-\d+)?|seed-2[.-]0(?:-[\w-]+)?)(?:-[\w-]+)*/i,
    min: 0,
    max: 30_720
  }
]

/** Lowercase and strip a namespace prefix (`deepseek/deepseek-r1` → `deepseek-r1`). */
function baseName(rawModelId: string): string {
  const lower = rawModelId.toLowerCase()
  return lower.slice(lower.lastIndexOf('/') + 1)
}

/**
 * Thinking-token limits for a raw model id (legacy `findTokenLimit`).
 * Tests the RAW string, unanchored — `provider::model` unique ids match too.
 */
export function findHeuristicTokenLimits(rawModelId: string): { min: number; max: number } | undefined {
  const rule = TOKEN_LIMIT_RULES.find((r) => r.pattern.test(rawModelId))
  return rule ? { min: rule.min, max: rule.max } : undefined
}

/**
 * Infer a model's reasoning controls from its id. Returns `undefined` when no
 * family knowledge matches — callers must gate on the model actually being
 * reasoning-capable (capability flag / `inferReasoningFromModelId`); this
 * function only knows the KNOBS, not whether the model reasons.
 */
export function inferReasoningControls(rawModelId: string): ReasoningControl[] | undefined {
  const id = baseName(rawModelId)
  const rule = EFFORT_RULES.find((r) => r.pattern.test(id))
  const limits = findHeuristicTokenLimits(id)
  const controls: ReasoningControl[] = []
  if (rule?.values) controls.push({ kind: 'effort', values: [...rule.values] })
  if (limits) controls.push({ kind: 'budget', min: limits.min, max: limits.max })
  if (rule?.toggle) controls.push({ kind: 'toggle' })
  return controls.length ? controls : undefined
}
