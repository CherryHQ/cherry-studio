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

import type { ModelConfig } from '../src/schemas/model'

const MODALITY = new Set(['text', 'image', 'audio', 'video'])
const VALID_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'max', 'auto'])
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

  const reasoning: NonNullable<CherryMeta['reasoning']> = {}
  for (const op of m.reasoning && m.reasoning_options ? m.reasoning_options : []) {
    if (op.type === 'effort' && op.values)
      reasoning.supportedEfforts = op.values.filter((v): v is Effort => VALID_EFFORTS.has(v))
    else if (
      op.type === 'budget_tokens' &&
      op.min != null &&
      op.max != null &&
      op.min >= 0 &&
      op.max > 0 &&
      op.min <= op.max
    )
      reasoning.thinkingTokenLimits = { min: op.min, max: op.max }
    else if (op.type === 'toggle') reasoning.supportedEfforts = ['none', 'auto']
  }
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
    context_length: z.number().optional(),
    architecture: z
      .object({ input_modalities: z.array(z.string()).optional(), output_modalities: z.array(z.string()).optional() })
      .optional(),
    supported_parameters: z.array(z.string()).optional(),
    pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).optional()
  })
  .loose()

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
  if (b.pricing && (!a.pricing || (b.pricing.cacheRead && !a.pricing.cacheRead))) out.pricing = b.pricing
  if (b.reasoning) {
    out.reasoning = { ...a.reasoning, ...b.reasoning }
    const ef = [...new Set([...(a.reasoning?.supportedEfforts ?? []), ...(b.reasoning.supportedEfforts ?? [])])]
    if (ef.length) out.reasoning.supportedEfforts = ef
  }
  if (b.openWeights) out.openWeights = true
  if (b.family && !a.family) out.family = b.family
  if (b.name && !a.name) out.name = b.name
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
