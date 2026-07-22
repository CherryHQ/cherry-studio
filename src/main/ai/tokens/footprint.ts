import { parseDataUrl } from '@shared/utils/dataUrl'
import type { DataContent, ModelMessage } from 'ai'
import sharp from 'sharp'

import type { TokenDialect } from './dialect'
import type { ImageDims } from './imageTokens'
import { imageTokensFor } from './profiles'
import type { TextTokenizer } from './textTokenizer'

/** Per-message structural framing (role markers, delimiters) the provider adds. */
const MESSAGE_OVERHEAD = 3
/** Per-tool-call / tool-result / tool-definition framing overhead. */
const TOOL_OVERHEAD = 10
/** Non-image file part (pdf, etc.) — we can't honestly estimate the payload; count a token or two of framing. */
const FILE_OVERHEAD = 5
/** Decode-work bound: a small file can still declare huge dimensions (bomb). Mirrors `src/main/utils/image.ts`. */
const MAX_INPUT_PIXELS = 100_000_000

/** The element type of a `ModelMessage`'s array content — every content part shape. */
type ContentPart = Exclude<ModelMessage['content'], string>[number]

export interface FootprintOptions {
  /** Dialect for image-cost dispatch. */
  dialect: TokenDialect
  /** Text tokenizer (injected so tests can use a deterministic counter). */
  tokenizer: TextTokenizer
}

/**
 * Estimate the token footprint of the converted `ModelMessage[]` — the exact shape
 * `Agent.stream` sends downstream. Text is tokenized; surviving vision images are measured
 * (sharp → pixel formula) or fall back to the per-dialect constant. Async because reading
 * image dimensions is async. Never throws — content comes from our own converter, but each
 * access is guarded so a malformed part yields a best-effort estimate.
 */
export async function estimateModelMessagesFootprint(
  messages: ModelMessage[],
  options: FootprintOptions
): Promise<number> {
  let total = 0
  for (const message of messages) {
    total += MESSAGE_OVERHEAD
    const content = message.content
    if (typeof content === 'string') {
      total += options.tokenizer.count(content)
      continue
    }
    const parts = await Promise.all((content as ContentPart[]).map((part) => partTokens(part, options)))
    total += parts.reduce((sum, n) => sum + n, 0)
  }
  return total
}

async function partTokens(part: ContentPart, { dialect, tokenizer }: FootprintOptions): Promise<number> {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return tokenizer.count(part.text)
    case 'image':
      return imageTokensFor(dialect, await imageDimensions(part.image))
    case 'file':
      return isImageMediaType(part.mediaType)
        ? imageTokensFor(dialect, await imageDimensions(part.data))
        : FILE_OVERHEAD + tokenizer.count(part.filename ?? '')
    case 'tool-call':
      return TOOL_OVERHEAD + tokenizer.count(part.toolName) + tokenizer.count(stringify(part.input))
    case 'tool-result':
      return TOOL_OVERHEAD + (await toolResultTokens(part.output, dialect, tokenizer))
    default:
      // tool-approval-request / tool-approval-response — negligible framing.
      return 0
  }
}

type ToolResultOutput = Extract<ContentPart, { type: 'tool-result' }>['output']

async function toolResultTokens(
  output: ToolResultOutput,
  dialect: TokenDialect,
  tokenizer: TextTokenizer
): Promise<number> {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return tokenizer.count(output.value)
    case 'json':
    case 'error-json':
      return tokenizer.count(stringify(output.value))
    case 'execution-denied':
      return tokenizer.count(output.reason ?? '')
    case 'content': {
      const items = await Promise.all(output.value.map((item) => contentItemTokens(item, dialect, tokenizer)))
      return items.reduce((sum, n) => sum + n, 0)
    }
    default:
      return 0
  }
}

type MultimodalItem = Extract<ToolResultOutput, { type: 'content' }>['value'][number]

async function contentItemTokens(
  item: MultimodalItem,
  dialect: TokenDialect,
  tokenizer: TextTokenizer
): Promise<number> {
  switch (item.type) {
    case 'text':
      return tokenizer.count(item.text)
    case 'image-data':
      // Raw base64 (no data: prefix) — the shape our converter now emits for tool-result images.
      return imageTokensFor(dialect, await dimensionsFromBytes(bytesFromBase64(item.data)))
    case 'media':
    case 'file-data':
      return isImageMediaType(item.mediaType)
        ? imageTokensFor(dialect, await dimensionsFromBytes(bytesFromBase64(item.data)))
        : FILE_OVERHEAD
    case 'image-url':
      // Not inline → can't measure; per-dialect fallback constant.
      return imageTokensFor(dialect)
    default:
      // file-url / file-id / image-file-id — the payload isn't inline, count only framing.
      return FILE_OVERHEAD
  }
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
    }
    // Bare base64 (rare) or a remote URL — treat as unmeasurable rather than risk mis-decoding a URL.
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

/** `JSON.stringify` that never throws and yields `''` for undefined/circular values. */
function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}
