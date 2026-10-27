/**
 * Normalizes the DotHoosh gateway's two model listings (`/v1/models` and `/anthropic/v1/models`) into
 * served models. The catalog generator and the app's live model list share it, so they cannot drift.
 */
import * as z from 'zod'

import { ENDPOINT_TYPE, MODALITY, MODEL_CAPABILITY } from '../schemas/enums'
import type { EndpointType } from '../schemas/enums'
import type { ModalityType, ModelCapabilityType } from '../schemas/model'

/** The Iran-hosted API; unreachable from outside Iran, which is why a keyless read goes to the mirror. */
export const DOTHOOSH_API_URL = 'https://gateway.dothoosh.com'
/** Byte-for-byte public mirror of the keyless listings (`/v1/models`, `/anthropic/v1/models`) behind Cloudflare. */
export const DOTHOOSH_MIRROR_URL = 'https://www.dothoosh.com/gateway'

type Usd = { currency: 'USD'; perMillionTokens: number }
type TierPricing = { input: Usd; output: Usd; cacheRead?: Usd; cacheWrite?: Usd }

export interface DotHooshPricing extends TierPricing {
  inputTokenTiers?: Array<{ minInputTokens: number } & TierPricing>
}

export interface DotHooshModel {
  id: string
  name: string
  endpointTypes: EndpointType[]
  contextWindow?: number
  maxOutputTokens?: number
  inputModalities: ModalityType[]
  outputModalities: ModalityType[]
  /** `add` is what the listing declares; `remove` is the capabilities it does not, so a base model cannot over-claim. */
  capabilities: { add: ModelCapabilityType[]; remove: ModelCapabilityType[] }
  pricing?: DotHooshPricing
}

// Every optional field is tolerant on its own: a malformed value is dropped instead of discarding the
// whole model (the gateway is the source of truth, but one odd field must not delete a model from a catalog).
const lenient = <T extends z.ZodType>(schema: T) => schema.nullish().catch(undefined)

const PriceString = lenient(z.union([z.string(), z.number()]))
const PriceTable = z
  .object({
    prompt: PriceString,
    completion: PriceString,
    input_cache_read: PriceString,
    input_cache_write: PriceString
  })
  .loose()
type PriceTableT = z.infer<typeof PriceTable>

const PricingTier = PriceTable.extend({ above_input_tokens: z.number().int().positive() })
type PricingTierT = z.infer<typeof PricingTier>

const Entry = z
  .object({
    id: z.string(),
    name: lenient(z.string()),
    display_name: lenient(z.string()),
    context_length: lenient(z.number()),
    context_window: lenient(z.number()),
    max_output_tokens: lenient(z.number()),
    top_provider: lenient(
      z.object({ context_length: lenient(z.number()), max_completion_tokens: lenient(z.number()) }).loose()
    ),
    architecture: lenient(
      z
        .object({ input_modalities: lenient(z.array(z.string())), output_modalities: lenient(z.array(z.string())) })
        .loose()
    ),
    pricing: lenient(PriceTable),
    pricing_tiers: lenient(z.array(z.unknown())),
    supported_parameters: lenient(z.array(z.string())),
    protocols: lenient(z.array(z.unknown()))
  })
  .loose()
type EntryT = z.infer<typeof Entry>

const Listing = z
  .object({ data: z.array(z.unknown()), has_more: z.unknown().optional(), last_id: z.unknown().optional() })
  .loose()

const MODALITIES = new Set<string>(Object.values(MODALITY))
// Capabilities a listing can speak to. Anything outside this set (image generation, rerank, ...) is left to the base model.
const LISTED_CAPABILITIES = [
  MODEL_CAPABILITY.FUNCTION_CALL,
  MODEL_CAPABILITY.REASONING,
  MODEL_CAPABILITY.STRUCTURED_OUTPUT,
  MODEL_CAPABILITY.IMAGE_RECOGNITION,
  MODEL_CAPABILITY.AUDIO_RECOGNITION,
  MODEL_CAPABILITY.VIDEO_RECOGNITION,
  MODEL_CAPABILITY.FILE_INPUT
] as const

const PROTOCOL_ENDPOINT: Record<string, EndpointType> = {
  'openai-chat-completions': ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  'openai-responses': ENDPOINT_TYPE.OPENAI_RESPONSES,
  'anthropic-messages': ENDPOINT_TYPE.ANTHROPIC_MESSAGES
}
const PROTOCOL_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(PROTOCOL_ENDPOINT).map(([protocol, endpoint]) => [endpoint, protocol])
)
// Responses first: the gateway refuses function tools on GPT-6 Chat Completions. A model on Chat
// Completions and the Anthropic route (DeepSeek) stays on Chat Completions.
const ENDPOINT_ORDER: EndpointType[] = [
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES
]

const positive = (n: number | null | undefined): number | undefined => (n != null && n > 0 ? n : undefined)

/** USD per ONE token (decimal string) -> USD per million tokens. Float noise is rounded away. */
function perMillion(value: string | number | null | undefined): Usd | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const perToken = Number(value)
  if (!Number.isFinite(perToken) || perToken < 0) return undefined
  return { currency: 'USD', perMillionTokens: Number((perToken * 1e6).toPrecision(12)) }
}

const dropUndefined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

/** A tier omits unchanged prices: they come from the BASE price, not the tier below; an unpriced cache write stays unset. */
function tierPrices(base: TierPricing, table: PriceTableT): TierPricing {
  return {
    input: perMillion(table.prompt) ?? base.input,
    output: perMillion(table.completion) ?? base.output,
    ...dropUndefined({
      cacheRead: perMillion(table.input_cache_read) ?? base.cacheRead,
      cacheWrite: perMillion(table.input_cache_write) ?? base.cacheWrite
    })
  }
}

function parsePricing(entry: EntryT): DotHooshPricing | undefined {
  const input = perMillion(entry.pricing?.prompt)
  const output = perMillion(entry.pricing?.completion)
  if (!entry.pricing || !input || !output) return undefined
  const base: TierPricing = {
    input,
    output,
    ...dropUndefined({
      cacheRead: perMillion(entry.pricing.input_cache_read),
      cacheWrite: perMillion(entry.pricing.input_cache_write)
    })
  }
  const rows = (entry.pricing_tiers ?? []).flatMap((row) => {
    const parsed = PricingTier.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
  const tiers: NonNullable<DotHooshPricing['inputTokenTiers']> = []
  for (const tier of rows.sort((a: PricingTierT, b: PricingTierT) => a.above_input_tokens - b.above_input_tokens)) {
    // `above_input_tokens` is exclusive: a request of exactly N tokens stays on the lower tier. Cherry's
    // `minInputTokens` is inclusive, so the tier starts at the first input count that qualifies, N + 1.
    const minInputTokens = tier.above_input_tokens + 1
    if (tiers.at(-1)?.minInputTokens === minInputTokens) continue
    tiers.push({ minInputTokens, ...tierPrices(base, tier) })
  }
  return { ...base, ...(tiers.length ? { inputTokenTiers: tiers } : {}) }
}

// What a protocol's `capabilities` list can say about a model, by the listing's own words.
const PROTOCOL_CAPABILITY: Record<string, (typeof LISTED_CAPABILITIES)[number]> = {
  tools: MODEL_CAPABILITY.FUNCTION_CALL,
  reasoning: MODEL_CAPABILITY.REASONING,
  'structured-output': MODEL_CAPABILITY.STRUCTURED_OUTPUT
}

/** The capability list a model's entry declares for one protocol, when it declares one. */
function protocolCapabilities(entry: EntryT, endpoint: EndpointType | undefined): Set<string> | undefined {
  if (!endpoint) return undefined
  const declared = (entry.protocols ?? []).find(
    (p) => (p as { protocol?: unknown } | null)?.protocol === PROTOCOL_NAME[endpoint]
  ) as { capabilities?: unknown } | undefined
  const list = declared?.capabilities
  return Array.isArray(list) && list.every((c) => typeof c === 'string') ? new Set<string>(list) : undefined
}

/**
 * Capabilities are read for the protocol Cherry will call first (`endpoint`): its own list wins over the
 * shared `supported_parameters`, which cover only what every protocol accepts (GPT-6 tools are Responses-only).
 */
function parseCapabilities(
  entry: EntryT,
  inputModalities: ModalityType[],
  endpoint: EndpointType | undefined
): DotHooshModel['capabilities'] {
  const parameters = new Set(entry.supported_parameters ?? [])
  const declared: Record<(typeof LISTED_CAPABILITIES)[number], boolean> = {
    [MODEL_CAPABILITY.FUNCTION_CALL]: parameters.has('tools'),
    [MODEL_CAPABILITY.REASONING]: parameters.has('reasoning'),
    [MODEL_CAPABILITY.STRUCTURED_OUTPUT]: parameters.has('structured_outputs') || parameters.has('response_format'),
    [MODEL_CAPABILITY.IMAGE_RECOGNITION]: inputModalities.includes(MODALITY.IMAGE),
    [MODEL_CAPABILITY.AUDIO_RECOGNITION]: inputModalities.includes(MODALITY.AUDIO),
    [MODEL_CAPABILITY.VIDEO_RECOGNITION]: inputModalities.includes(MODALITY.VIDEO),
    // The listing has no file modality today; direct file input stays off until it declares one.
    [MODEL_CAPABILITY.FILE_INPUT]: (entry.architecture?.input_modalities ?? []).includes('file')
  }
  const own = protocolCapabilities(entry, endpoint)
  if (own) {
    for (const [token, capability] of Object.entries(PROTOCOL_CAPABILITY)) declared[capability] = own.has(token)
  }
  return {
    add: LISTED_CAPABILITIES.filter((c) => declared[c]),
    remove: LISTED_CAPABILITIES.filter((c) => !declared[c])
  }
}

function openAiEndpoints(entry: EntryT): EndpointType[] {
  const protocols = (entry.protocols ?? []).flatMap((p) => {
    const name = typeof p === 'string' ? p : (p as { protocol?: unknown } | null)?.protocol
    return typeof name === 'string' ? [name] : []
  })
  const endpoints = protocols.flatMap((p) => (PROTOCOL_ENDPOINT[p] ? [PROTOCOL_ENDPOINT[p]] : []))
  // A model without a protocol list is reachable on Chat Completions, the gateway's baseline route.
  if (!endpoints.length) return [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
  const openai = endpoints.filter((e) => e !== ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  // A model the OpenAI listing serves only over Anthropic Messages still has that route.
  return openai.length ? openai : endpoints
}

function entriesOf(raw: unknown): EntryT[] {
  const listing = Listing.safeParse(raw)
  if (!listing.success) return []
  return listing.data.data.flatMap((item) => {
    const parsed = Entry.safeParse(item)
    return parsed.success && parsed.data.id.trim() ? [{ ...parsed.data, id: parsed.data.id.trim() }] : []
  })
}

/** Usable models in a raw listing body; 0 for an error envelope, non-listing, empty or all-invalid list. */
export function countListedModels(raw: unknown): number {
  return entriesOf(raw).length
}

const ANTHROPIC_MAX_PAGES = 20

/** Read every page (`has_more` + `last_id`); a bad page or cursor throws rather than return a partial catalog. */
export async function readAnthropicListing(
  fetchPage: (afterId?: string) => Promise<unknown>
): Promise<{ data: unknown[] } & Record<string, unknown>> {
  const data: unknown[] = []
  const seen = new Set<string>()
  let afterId: string | undefined
  for (let page = 0; page < ANTHROPIC_MAX_PAGES; page++) {
    const raw = await fetchPage(afterId)
    const parsed = Listing.safeParse(raw)
    if (!parsed.success) throw new Error('DotHoosh Anthropic listing page is not a model list')
    data.push(...parsed.data.data)
    if (parsed.data.has_more !== true) return { ...parsed.data, data }
    const last = parsed.data.last_id
    if (typeof last !== 'string' || !last || seen.has(last)) {
      throw new Error('DotHoosh Anthropic listing claims more pages without a usable cursor')
    }
    seen.add(last)
    afterId = last
  }
  throw new Error('DotHoosh Anthropic listing has more pages than the page limit')
}

/** Merge both listings (either may be absent); a model on both routes takes its fields from the OpenAI entry. */
export function parseDotHooshListings(listings: { openai?: unknown; anthropic?: unknown }): DotHooshModel[] {
  const openai = entriesOf(listings.openai)
  const anthropic = entriesOf(listings.anthropic)
  const byId = new Map<string, { entry: EntryT; endpoints: Set<EndpointType> }>()
  for (const entry of openai) {
    const slot = byId.get(entry.id) ?? { entry, endpoints: new Set<EndpointType>() }
    for (const endpoint of openAiEndpoints(entry)) slot.endpoints.add(endpoint)
    byId.set(entry.id, slot)
  }
  for (const entry of anthropic) {
    const slot = byId.get(entry.id) ?? { entry, endpoints: new Set<EndpointType>() }
    slot.endpoints.add(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    byId.set(entry.id, slot)
  }

  return [...byId.values()].map(({ entry, endpoints }) => {
    const inputModalities = (entry.architecture?.input_modalities ?? ['text']).filter((m): m is ModalityType =>
      MODALITIES.has(m)
    )
    const outputModalities = (entry.architecture?.output_modalities ?? ['text']).filter((m): m is ModalityType =>
      MODALITIES.has(m)
    )
    const pricing = parsePricing(entry)
    const endpointTypes = ENDPOINT_ORDER.filter((e) => endpoints.has(e))
    return {
      id: entry.id,
      name: entry.display_name?.trim() || entry.name?.trim() || entry.id,
      endpointTypes,
      ...dropUndefined({
        contextWindow:
          positive(entry.context_length) ??
          positive(entry.context_window) ??
          positive(entry.top_provider?.context_length),
        maxOutputTokens: positive(entry.max_output_tokens) ?? positive(entry.top_provider?.max_completion_tokens)
      }),
      inputModalities,
      outputModalities,
      capabilities: parseCapabilities(entry, inputModalities, endpointTypes[0]),
      ...(pricing ? { pricing } : {})
    }
  })
}
