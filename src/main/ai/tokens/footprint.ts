import { parseDataUrl } from '@shared/utils/dataUrl'
import type { DataContent, ModelMessage } from 'ai'
import sharp from 'sharp'

import type { TokenDialect } from './dialect'
import type { ImageDims } from './imageTokens'
import type { MediaKind } from './mediaTokens'
import { imageTokensFor, mediaTokensFor } from './profiles'
import type { TextTokenizer } from './textTokenizer'

/** Per-message structural framing (role markers, delimiters) the provider adds. */
const MESSAGE_OVERHEAD = 3
/** Per-tool-call / tool-result / tool-definition framing overhead. */
const TOOL_OVERHEAD = 10
/** Opaque non-media file part (pdf, zip, …) — the payload isn't priced by a rule we know; count framing. */
const FILE_OVERHEAD = 5
/** Decode-work bound: a small file can still declare huge dimensions (bomb). Mirrors `src/main/utils/image.ts`. */
const MAX_INPUT_PIXELS = 100_000_000

/** The element type of a `ModelMessage`'s array content — every content part shape. */
type ContentPart = Exclude<ModelMessage['content'], string>[number]
type ToolResultOutput = Extract<ContentPart, { type: 'tool-result' }>['output']
type MultimodalItem = Extract<ToolResultOutput, { type: 'content' }>['value'][number]

/** What a measurement pass learned about one media-bearing part, keyed by that part's identity. */
export interface MediaMeasurement {
  dims?: ImageDims
  durationSec?: number
}
export type MediaMeasurements = Map<object, MediaMeasurement>

export interface FootprintOptions {
  /** Dialect for image/media cost dispatch. */
  dialect: TokenDialect
  /** Text tokenizer (injected so tests can use a deterministic counter). */
  tokenizer: TextTokenizer
  /**
   * Pre-measured media, from {@link measureMedia}. Omit it (the in-loop compaction path) and
   * every media part falls back to its per-dialect constant — no decoding, fully synchronous.
   */
  measure?: MediaMeasurements
}

/**
 * Token footprint of the converted `ModelMessage[]` — the exact shape `Agent.stream` sends
 * downstream. **Synchronous and allocation-cheap**: text is tokenized, media is priced from
 * `options.measure` when present and from the per-dialect constant otherwise.
 *
 * This is the single walker for both altitudes. The gateway `count_tokens` endpoints call
 * {@link estimateModelMessagesFootprint}, which measures first and then lands here; the
 * in-loop compaction hook (`prepareStep`, which runs on every step and must not block)
 * calls this directly with no measurements.
 *
 * Media payload bytes are NEVER handed to the tokenizer — that is the #17837 bug (a 13 MB
 * MP3 scored ~3.7 M tokens against the provider's real 20 k). Never throws: content comes
 * from our own converter, but each access is guarded so a malformed part still yields a
 * best-effort number.
 */
export function estimateModelMessagesSync(messages: ModelMessage[], options: FootprintOptions): number {
  let total = 0
  for (const message of messages) {
    total += MESSAGE_OVERHEAD
    const content = message.content
    if (typeof content === 'string') {
      total += options.tokenizer.count(content)
      continue
    }
    for (const part of content as ContentPart[]) total += partTokens(part, options)
  }
  return total
}

/**
 * Measure-then-estimate: read real image dimensions (and, where available, media duration)
 * off the inline payloads, then run the shared walker. Async only because decoding is.
 */
export async function estimateModelMessagesFootprint(
  messages: ModelMessage[],
  options: Omit<FootprintOptions, 'measure'>
): Promise<number> {
  const measure = await measureMedia(messages)
  return estimateModelMessagesSync(messages, { ...options, measure })
}

function partTokens(part: ContentPart, options: FootprintOptions): number {
  const { dialect, tokenizer, measure } = options
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return tokenizer.count(part.text)
    case 'image':
      return imageTokensFor(dialect, measure?.get(part)?.dims)
    case 'file': {
      if (isImageMediaType(part.mediaType)) return imageTokensFor(dialect, measure?.get(part)?.dims)
      const kind = mediaKindOf(part.mediaType)
      if (kind) return mediaTokensFor(dialect, kind, measure?.get(part)?.durationSec)
      return FILE_OVERHEAD + tokenizer.count(part.filename ?? '')
    }
    case 'tool-call':
      return TOOL_OVERHEAD + tokenizer.count(part.toolName) + tokenizer.count(stringify(part.input))
    case 'tool-result':
      return TOOL_OVERHEAD + toolResultTokens(part.output, options)
    default:
      // tool-approval-request / tool-approval-response — negligible framing.
      return 0
  }
}

function toolResultTokens(output: ToolResultOutput, options: FootprintOptions): number {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return options.tokenizer.count(output.value)
    case 'json':
    case 'error-json':
      return options.tokenizer.count(stringify(output.value))
    case 'execution-denied':
      return options.tokenizer.count(output.reason ?? '')
    case 'content': {
      let total = 0
      for (const item of output.value) total += contentItemTokens(item, options)
      return total
    }
    default:
      return 0
  }
}

function contentItemTokens(item: MultimodalItem, { dialect, tokenizer, measure }: FootprintOptions): number {
  switch (item.type) {
    case 'text':
      return tokenizer.count(item.text)
    case 'image-data':
      // Raw base64 (no data: prefix).
      return imageTokensFor(dialect, measure?.get(item)?.dims)
    case 'media':
    case 'file-data': {
      if (isImageMediaType(item.mediaType)) return imageTokensFor(dialect, measure?.get(item)?.dims)
      const kind = mediaKindOf(item.mediaType)
      if (kind) return mediaTokensFor(dialect, kind, measure?.get(item)?.durationSec)
      return FILE_OVERHEAD
    }
    case 'image-url':
      // Not inline → can't measure; per-dialect fallback constant.
      return imageTokensFor(dialect)
    default:
      // file-url / file-id / image-file-id — the payload isn't inline, count only framing.
      return FILE_OVERHEAD
  }
}

/** One media payload found in the prompt, paired with the part object that owns it. */
interface MediaNode {
  owner: object
  kind: 'image' | MediaKind
  data: DataContent | URL
}

/**
 * Enumerate the inline media payloads in a prompt.
 *
 * Deliberately narrower than the token walker: it only has to find payloads worth decoding.
 * If the two ever drift, a node this misses simply falls back to its per-dialect constant —
 * degraded precision, never a wrong-shaped estimate.
 */
function* mediaNodes(messages: ModelMessage[]): Generator<MediaNode> {
  for (const message of messages) {
    if (typeof message.content === 'string') continue
    for (const part of message.content as ContentPart[]) {
      if (part.type === 'image') {
        yield { owner: part, kind: 'image', data: part.image }
      } else if (part.type === 'file') {
        const kind = isImageMediaType(part.mediaType) ? 'image' : mediaKindOf(part.mediaType)
        if (kind) yield { owner: part, kind, data: part.data }
      } else if (part.type === 'tool-result' && part.output.type === 'content') {
        for (const item of part.output.value) {
          if (item.type === 'image-data') {
            yield { owner: item, kind: 'image', data: item.data }
          } else if (item.type === 'media' || item.type === 'file-data') {
            const kind = isImageMediaType(item.mediaType) ? 'image' : mediaKindOf(item.mediaType)
            if (kind) yield { owner: item, kind, data: item.data }
          }
        }
      }
    }
  }
}

/**
 * Decode what the inline payloads can tell us: pixel dimensions for images. Audio/video
 * duration needs a container probe, which is not wired here yet — those parts resolve to
 * their per-dialect fallback until it is.
 *
 * Never throws; an unreadable payload is simply absent from the map.
 */
export async function measureMedia(messages: ModelMessage[]): Promise<MediaMeasurements> {
  const nodes = [...mediaNodes(messages)]
  const measurements: MediaMeasurements = new Map()
  await Promise.all(
    nodes.map(async (node) => {
      if (node.kind !== 'image') return
      const dims = await imageDimensions(node.data)
      if (dims) measurements.set(node.owner, { dims })
    })
  )
  return measurements
}

/**
 * Token cost of one tool definition's LLM-visible text (name + description + schema).
 * The caller passes the **canonical** schema: Anthropic `input_schema` is already
 * canonical JSONSchema; registry tools (Zod / `jsonSchema()` wrappers) must normalize via
 * `serializeToolSchema` first. Shared by the gateway `count_tokens` estimator and the
 * tool-defer decision so both count tool definitions with one formula + tokenizer.
 */
export function countToolTokens(
  tool: { name?: unknown; description?: unknown; schema?: unknown },
  tokenizer: TextTokenizer
): number {
  return tokenizer.count(stringify({ name: tool.name, description: tool.description, schema: tool.schema }))
}

/**
 * Token cost of the request's separate `tools` field, counted from the raw Anthropic
 * `body.tools` — the exact definitions the provider tokenizes, not the AI SDK `ToolSet`
 * (whose zod schema is opaque). `input_schema` is already canonical JSONSchema.
 */
export function countToolDefs(rawTools: unknown, tokenizer: TextTokenizer): number {
  if (!Array.isArray(rawTools)) return 0
  let total = 0
  for (const tool of rawTools) {
    if (!tool || typeof tool !== 'object') continue
    const { name, description, input_schema } = tool as Record<string, unknown>
    total += TOOL_OVERHEAD + countToolTokens({ name, description, schema: input_schema }, tokenizer)
  }
  return total
}

/** Read pixel dimensions from an image `DataContent | URL`; `undefined` for URLs / unreadable bytes. */
async function imageDimensions(value: DataContent | URL): Promise<ImageDims | undefined> {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      const parts = parseDataUrl(value)
      if (parts?.isBase64) return dimensionsFromBytes(bytesFromBase64(parts.data))
    } else if (!value.includes('://')) {
      // Raw base64 (the shape tool-result `image-data` carries) — a URL would contain a scheme.
      return dimensionsFromBytes(bytesFromBase64(value))
    }
    // Remote URL — unmeasurable without fetching.
    return undefined
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || Buffer.isBuffer(value)) {
    return dimensionsFromBytes(value)
  }
  return undefined
}

function bytesFromBase64(data: string): Buffer | undefined {
  try {
    return Buffer.from(data, 'base64')
  } catch {
    return undefined
  }
}

async function dimensionsFromBytes(
  bytes: Uint8Array | ArrayBuffer | Buffer | undefined
): Promise<ImageDims | undefined> {
  if (!bytes) return undefined
  try {
    const { width, height } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    return width && height ? { width, height } : undefined
  } catch {
    return undefined
  }
}

function isImageMediaType(mediaType: string | undefined): boolean {
  return typeof mediaType === 'string' && mediaType.startsWith('image/')
}

/** `audio`/`video` for a duration-priced media type, `undefined` for anything else. */
function mediaKindOf(mediaType: string | undefined): MediaKind | undefined {
  if (typeof mediaType !== 'string') return undefined
  if (mediaType.startsWith('audio/')) return 'audio'
  if (mediaType.startsWith('video/')) return 'video'
  return undefined
}

/** `JSON.stringify` that never throws and yields `''` for undefined/circular values. */
function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}
