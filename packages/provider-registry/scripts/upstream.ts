/**
 * Parse upstream catalog entries (models.dev / OpenRouter) into Cherry metadata, with zod.
 *
 * Why zod: the upstream shapes are loose and change over time. A schema validates each entry
 * (a drifted/garbage entry is skipped, not crashed) and keeps the mapping declarative and typed,
 * instead of hand-reaching into `m.modalities?.input` everywhere.
 *
 * Why merge by UNION: the SAME model is listed by many providers that disagree (e.g. `minimax-m3`
 * is text-only on one host, text+image+video on another). Capabilities/modalities are intrinsic —
 * if any credible source reports video, the model supports video — so we union them across sources
 * (and take max limits / best pricing), rather than letting one "winner" source hide a capability.
 */
import * as z from 'zod'

import type { ModelConfig, ReasoningSupport } from '../src/schemas/model'
import type { ProviderModelOverride } from '../src/schemas/provider-models'

const MODALITY = new Set(['text', 'image', 'audio', 'video'])
const VALID_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'])
export const CAP_ORDER = [
  'function-call',
  'reasoning',
  'image-recognition',
  'image-generation',
  'audio-recognition',
  'audio-generation',
  'video-recognition',
  'video-generation',
  'structured-output',
  'file-input'
] as const

/** The metadata subset of a `ModelConfig` we fill from upstream — reuse the schema's field types, don't re-declare. */
export type CherryMeta = Partial<
  Pick<
    ModelConfig,
    | 'name'
    | 'family'
    | 'openWeights'
    | 'capabilities'
    | 'inputModalities'
    | 'outputModalities'
    | 'contextWindow'
    | 'maxInputTokens'
    | 'maxOutputTokens'
    | 'pricing'
    | 'reasoning'
  >
>
type Caps = NonNullable<CherryMeta['capabilities']>[number]
type Effort = NonNullable<NonNullable<CherryMeta['reasoning']>['supportedEfforts']>[number]

const usd = (n?: number) => (n == null ? undefined : { currency: 'USD' as const, perMillionTokens: n })
const dropUndef = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

// ── models.dev ───────────────────────────────────────────────────────────────
const MdEntry = z
  .object({
    name: z.string().optional(),
    family: z.string().optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    open_weights: z.boolean().optional(),
    modalities: z.object({ input: z.array(z.string()).optional(), output: z.array(z.string()).optional() }).optional(),
    limit: z.object({ context: z.number().optional(), output: z.number().optional() }).optional(),
    cost: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional()
      })
      .optional(),
    reasoning_options: z
      .array(
        z.object({
          type: z.string(),
          values: z.array(z.string()).optional(),
          min: z.number().optional(),
          max: z.number().optional()
        })
      )
      .optional()
  })
  .loose()

export function parseMdEntry(raw: unknown): CherryMeta | null {
  const p = MdEntry.safeParse(raw)
  if (!p.success) return null
  const m = p.data
  const caps = new Set<Caps>()
  if (m.tool_call) caps.add('function-call')
  if (m.reasoning) caps.add('reasoning')
  if (m.structured_output) caps.add('structured-output')
  if (m.attachment) caps.add('file-input')
  const inp = m.modalities?.input ?? [],
    out = m.modalities?.output ?? []
  if (inp.includes('image')) caps.add('image-recognition')
  if (inp.includes('audio')) caps.add('audio-recognition')
  if (inp.includes('video')) caps.add('video-recognition')
  if (out.includes('image')) caps.add('image-generation')
  if (out.includes('audio')) caps.add('audio-generation')
  if (out.includes('video')) caps.add('video-generation')

  // Lossless controls declaration (the source of truth); the legacy pair
  // (supportedEfforts / thinkingTokenLimits) is re-derived from it by the
  // buildModels normalization pass via deriveLegacyReasoningFields.
  const reasoning: NonNullable<CherryMeta['reasoning']> = {}
  const controls: NonNullable<NonNullable<CherryMeta['reasoning']>['controls']> = []
  for (const op of m.reasoning && m.reasoning_options ? m.reasoning_options : []) {
    if (op.type === 'effort' && op.values) {
      const values = op.values.filter((v): v is Effort => VALID_EFFORTS.has(v))
      if (values.length) controls.push({ kind: 'effort', values })
    } else if (
      op.type === 'budget_tokens' &&
      op.min != null &&
      op.max != null &&
      op.min >= 0 &&
      op.max > 0 &&
      op.min <= op.max
    ) {
      controls.push({ kind: 'budget', min: op.min, max: op.max })
    } else if (op.type === 'toggle') {
      controls.push({ kind: 'toggle' })
    }
  }
  if (controls.length) reasoning.controls = controls
  const pricing =
    m.cost?.input != null && m.cost?.output != null
      ? dropUndef({
          input: usd(m.cost.input),
          output: usd(m.cost.output),
          cacheRead: usd(m.cost.cache_read),
          cacheWrite: usd(m.cost.cache_write)
        })
      : undefined

  return dropUndef({
    capabilities: caps.size ? [...caps] : undefined,
    inputModalities: inp.filter((x) => MODALITY.has(x)),
    outputModalities: out.filter((x) => MODALITY.has(x)),
    contextWindow: m.limit?.context,
    maxOutputTokens: m.limit?.output,
    pricing,
    reasoning: Object.keys(reasoning).length ? reasoning : undefined,
    openWeights: typeof m.open_weights === 'boolean' ? m.open_weights : undefined,
    family: m.family,
    name: m.name
  }) as CherryMeta
}

// ── OpenRouter ───────────────────────────────────────────────────────────────
const OrEntry = z
  .object({
    name: z.string().optional(),
    context_length: z.number().optional(),
    architecture: z
      .object({ input_modalities: z.array(z.string()).optional(), output_modalities: z.array(z.string()).optional() })
      .optional(),
    supported_parameters: z.array(z.string()).optional(),
    pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).optional(),
    reasoning: z
      .object({
        supported_efforts: z.array(z.string()).optional(),
        default_effort: z.string().optional(),
        default_enabled: z.boolean().optional(),
        supports_max_tokens: z.boolean().optional(),
        mandatory: z.boolean().optional()
      })
      .optional()
  })
  .loose()

/** Endpoint-specific reasoning controls published by OpenRouter's model catalog. */
export function parseOpenRouterReasoning(raw: unknown): ReasoningSupport | null {
  const parsed = OrEntry.safeParse(raw)
  if (!parsed.success || !parsed.data.reasoning) return null

  const descriptor = parsed.data.reasoning
  const hasPublishedCapability =
    descriptor.supported_efforts !== undefined ||
    descriptor.default_effort !== undefined ||
    descriptor.default_enabled !== undefined ||
    descriptor.supports_max_tokens !== undefined ||
    descriptor.mandatory !== undefined
  if (!hasPublishedCapability) return null

  const efforts = (descriptor.supported_efforts ?? []).filter((value): value is Effort => VALID_EFFORTS.has(value))
  const selectableEfforts = descriptor.mandatory ? efforts.filter((value) => value !== 'none') : efforts
  const controls: NonNullable<ReasoningSupport['controls']> = []
  const defaultEffort = VALID_EFFORTS.has(descriptor.default_effort ?? '')
    ? (descriptor.default_effort as Effort)
    : undefined

  if (selectableEfforts.length > 0) {
    controls.push({
      kind: 'effort',
      values: selectableEfforts,
      ...(defaultEffort && selectableEfforts.includes(defaultEffort) ? { default: defaultEffort } : {})
    })
  } else if (!descriptor.supports_max_tokens && !descriptor.mandatory && descriptor.default_enabled !== undefined) {
    controls.push({ kind: 'toggle', default: descriptor.default_enabled })
  }

  return {
    controls,
    ...(selectableEfforts.length > 0 ? { supportedEfforts: selectableEfforts } : {}),
    ...(defaultEffort && selectableEfforts.includes(defaultEffort) ? { defaultEffort } : {})
  }
}

/** Merge generated OpenRouter support with a hand-written exact override. Hand-written fields win. */
export function mergeOpenRouterReasoningContracts(
  support: ReasoningSupport,
  handwritten: ProviderModelOverride['reasoningContracts']
): NonNullable<ProviderModelOverride['reasoningContracts']> {
  const endpoint = 'openai-chat-completions'
  return {
    ...handwritten,
    [endpoint]: {
      support,
      ...handwritten?.[endpoint]
    }
  }
}

export function parseOrEntry(raw: unknown): CherryMeta | null {
  const p = OrEntry.safeParse(raw)
  if (!p.success) return null
  const m = p.data
  const caps = new Set<Caps>()
  const sp = m.supported_parameters ?? []
  if (sp.includes('tools')) caps.add('function-call')
  if (sp.includes('reasoning')) caps.add('reasoning')
  if (sp.includes('structured_outputs') || sp.includes('response_format')) caps.add('structured-output')
  const inp = m.architecture?.input_modalities ?? [],
    out = m.architecture?.output_modalities ?? []
  if (inp.includes('image')) caps.add('image-recognition')
  if (inp.includes('audio')) caps.add('audio-recognition')
  if (inp.includes('video')) caps.add('video-recognition')
  if (inp.includes('file')) caps.add('file-input')
  if (out.includes('image')) caps.add('image-generation')
  if (out.includes('audio')) caps.add('audio-generation')

  return dropUndef({
    capabilities: caps.size ? [...caps] : undefined,
    inputModalities: inp.filter((x) => MODALITY.has(x)),
    outputModalities: out.filter((x) => MODALITY.has(x)),
    contextWindow: m.context_length,
    name: m.name,
    pricing: m.pricing?.prompt
      ? { input: usd(+m.pricing.prompt * 1e6)!, output: usd(+(m.pricing.completion || 0) * 1e6)! }
      : undefined
  }) as CherryMeta
}

// ── merge across sources (the fix for the minimax-m3 video gap) ───────────────
const uniqOrdered = (arr: string[]) => [
  ...CAP_ORDER.filter((x) => arr.includes(x)),
  ...arr.filter((x) => !CAP_ORDER.includes(x as any))
]

export function mergeMeta(a: CherryMeta, b: CherryMeta): CherryMeta {
  const out: CherryMeta = { ...a }
  if (b.capabilities)
    out.capabilities = uniqOrdered([...new Set([...(a.capabilities ?? []), ...b.capabilities])]) as Caps[]
  for (const k of ['inputModalities', 'outputModalities'] as const)
    if (b[k]?.length) out[k] = [...new Set([...(a[k] ?? []), ...b[k]])]
  if (b.contextWindow) out.contextWindow = Math.max(a.contextWindow ?? 0, b.contextWindow)
  if (b.maxOutputTokens) out.maxOutputTokens = Math.max(a.maxOutputTokens ?? 0, b.maxOutputTokens)
  // Per-field union — never overwrite wholesale (a `{cacheRead}`-only source must not drop a's input/output).
  // `a` (the earlier/curated source) wins per-field conflicts; `b` only fills fields `a` is missing.
  if (b.pricing) out.pricing = { ...b.pricing, ...a.pricing }
  if (b.reasoning) {
    out.reasoning = { ...a.reasoning, ...b.reasoning }
    const controls = mergeReasoningControls(a.reasoning?.controls, b.reasoning.controls)
    if (controls.length) out.reasoning.controls = controls
    const ef = [...new Set([...(a.reasoning?.supportedEfforts ?? []), ...(b.reasoning.supportedEfforts ?? [])])]
    if (ef.length) out.reasoning.supportedEfforts = ef
  }
  if (b.openWeights) out.openWeights = true
  if (b.family && !a.family) out.family = b.family
  if (b.name && !a.name) out.name = b.name
  return out
}

type Controls = NonNullable<NonNullable<CherryMeta['reasoning']>['controls']>

/**
 * Union reasoning controls per kind across sources (same spirit as the
 * capability union): effort values union (a's order first), budget range
 * widens, toggle survives if either side declares it.
 */
function mergeReasoningControls(a: Controls | undefined, b: Controls | undefined): Controls {
  const pick = <K extends Controls[number]['kind']>(list: Controls | undefined, kind: K) =>
    list?.find((c): c is Extract<Controls[number], { kind: K }> => c.kind === kind)
  const out: Controls = []
  const [ea, eb] = [pick(a, 'effort'), pick(b, 'effort')]
  if (ea || eb) {
    out.push({
      kind: 'effort',
      values: [...new Set([...(ea?.values ?? []), ...(eb?.values ?? [])])],
      ...((ea?.default ?? eb?.default) != null ? { default: ea?.default ?? eb?.default } : {})
    })
  }
  const [ba, bb] = [pick(a, 'budget'), pick(b, 'budget')]
  if (ba || bb) {
    out.push({
      kind: 'budget',
      min: Math.min(ba?.min ?? Infinity, bb?.min ?? Infinity),
      max: Math.max(ba?.max ?? 0, bb?.max ?? 0),
      ...((ba?.default ?? bb?.default) != null ? { default: ba?.default ?? bb?.default } : {})
    })
  }
  const toggle = pick(a, 'toggle') ?? pick(b, 'toggle')
  if (toggle) out.push(toggle)
  return out
}

/** maxOutputTokens must not exceed contextWindow (schema invariant). */
export function finalizeMeta(m: CherryMeta): CherryMeta {
  if (m.contextWindow && m.maxOutputTokens && m.maxOutputTokens > m.contextWindow) {
    // oxlint-disable-next-line no-unused-vars
    const { maxOutputTokens, ...rest } = m
    return rest
  }
  return m
}

// ── raw upstream API shapes ───────────────────────────────────────────────────
// Validate only the TOP-LEVEL structure on load (so `md`/`or` are typed, not `any`). Each model entry
// is parsed lazily — and skipped if malformed — by parseMdEntry/parseOrEntry, so one drifted entry
// never fails the whole generation.

/** models.dev `api.json`: `{ [providerKey]: { models: { [modelId]: entry }, … } }`. */
export const ModelsDevApiSchema = z.record(
  z.string(),
  z.object({ models: z.record(z.string(), z.unknown()).optional() }).loose()
)
export type ModelsDevApi = z.infer<typeof ModelsDevApiSchema>

/** OpenRouter `/api/v1/models`: `{ data: [{ id, … }] }`. */
export const OpenRouterApiSchema = z.object({ data: z.array(z.object({ id: z.string() }).loose()).optional() }).loose()
export type OpenRouterApi = z.infer<typeof OpenRouterApiSchema>
