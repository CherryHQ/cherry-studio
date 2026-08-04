/**
 * Tool-result truncation over a LanguageModelV3Prompt.
 *
 * Vendored from @context-chef/ai-sdk-middleware 1.6.0 (MIT, same author).
 */
import type {
  LanguageModelV3Prompt,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart
} from '@ai-sdk/provider'

import { Offloader, type VFSStorageAdapter } from './offloader'
import { PERSISTED_OUTPUT_TAG } from './prompts'
import type { ContextLogger } from './types'

/**
 * Structure-aware trimming for a tool's output: `deflate` splits a value into
 * an identity skeleton plus per-entity text blobs (returning `null` for
 * non-codec-shaped values — errors, steer strings, markers), `assemble`
 * rebuilds the value with each blob's text swapped for the (possibly trimmed)
 * text under the same key. `blob.key` is a JSON-pointer-lite path into the
 * skeleton (`"/<index>/content"`, `"/text"`), fixed here because persisted
 * envelopes reuse it — stored data must inflate without the codec.
 *
 * Passed into the truncator as DATA on a `perTool` entry (functions-as-data):
 * aiCore stays provider/tool-agnostic and never imports tool code. `assemble`
 * must preserve key insertion order — the assembled value is stringified into
 * the prompt and must be byte-stable across lanes for prefix caching.
 */
export interface EntityToolOutputCodec {
  deflate(value: unknown): { skeleton: unknown; blobs: Array<{ key: string; text: string }> } | null
  assemble(skeleton: unknown, texts: Record<string, string>): unknown
}

export interface TruncateOptions {
  /** Character count threshold to trigger truncation. */
  threshold: number
  /** Characters to preserve from the start. Default: 0 */
  headChars?: number
  /** Characters to preserve from the end. Default: 1000 */
  tailChars?: number
  /**
   * Storage adapter for persisting original content before truncation.
   * When provided, truncated output includes a retrieval handle (physical
   * path and/or `context://vfs/` URI). When omitted, original content is
   * discarded after truncation.
   */
  storage?: VFSStorageAdapter
  /**
   * Per-tool overrides applied on top of the defaults above.
   *
   * - String entry → preserve: never truncate this tool's result. Storage
   *   is bypassed entirely (nothing written to VFS).
   * - Object entry → override `threshold` / `headChars` / `tailChars` for
   *   that tool only. Storage behavior unchanged.
   *
   * Tools not listed fall back to the top-level defaults. If the same
   * `name` appears more than once, the last entry wins (a bare string
   * after an object discards that object → becomes preserve).
   *
   * Notes:
   * - Wildcards / globs are NOT supported.
   * - `storage` cannot be overridden per-tool.
   * - `perTool` only affects the truncate step; a preserved message may
   *   still be summarized by compression.
   */
  perTool?: Array<
    | string
    | {
        name: string
        threshold?: number
        headChars?: number
        tailChars?: number
        /** Entity-level trimming for structured (`json`) outputs: per-entity
         *  content is trimmed while the identity skeleton stays verbatim.
         *  Non-json outputs and `deflate → null` fall back to the opaque path. */
        codec?: EntityToolOutputCodec
      }
  >
}

/**
 * Truncates tool-result content within an AI SDK prompt when it exceeds the configured threshold.
 * When a storage adapter is provided, original content is persisted and a retrieval handle is included in the output.
 */
export async function truncateToolResults(
  prompt: LanguageModelV3Prompt,
  options: TruncateOptions,
  logger: ContextLogger = console
): Promise<LanguageModelV3Prompt> {
  const { threshold, headChars = 0, tailChars = 1000, storage } = options

  const offloader = storage ? new Offloader({ threshold, adapter: storage }) : null
  const policy = buildPolicyMap(options.perTool)

  const result: LanguageModelV3Prompt = []

  for (const msg of prompt) {
    if (msg.role !== 'tool') {
      result.push(msg)
      continue
    }

    const newContent: typeof msg.content = []

    for (const part of msg.content) {
      if (part.type !== 'tool-result') {
        newContent.push(part)
        continue
      }

      const toolPolicy = policy.get(part.toolName)
      if (toolPolicy?.preserve) {
        // Preserve = full bypass: no truncation, no storage write.
        newContent.push(part)
        continue
      }

      const effThreshold = toolPolicy?.threshold ?? threshold
      const effHeadChars = toolPolicy?.headChars ?? headChars
      const effTailChars = toolPolicy?.tailChars ?? tailChars

      // Entity-level path: structured output + a codec → trim per-entity
      // content, keep the identity skeleton verbatim.
      if (toolPolicy?.codec && part.output.type === 'json') {
        const trimmed = await truncateEntities(
          part,
          toolPolicy.codec,
          { threshold: effThreshold, headChars: effHeadChars, tailChars: effTailChars },
          offloader,
          logger
        )
        if (trimmed !== null) {
          newContent.push(trimmed)
          continue
        }
        // deflate → null (error object, steer note, …): fall through to opaque.
      }

      const text = extractText(part.output)
      if (text.length <= effThreshold || effHeadChars + effTailChars >= text.length) {
        newContent.push(part)
        continue
      }

      // Never re-truncate an already-persisted marker: with a threshold
      // configured below the marker size (the pref has no enforced minimum),
      // the marker itself would be offloaded recursively — a marker pointing
      // at a marker. Checked only on oversized results to avoid scanning
      // every output.
      if (text.includes(PERSISTED_OUTPUT_TAG)) {
        newContent.push(part)
        continue
      }

      // With storage: use Offloader to persist original and get a URI-annotated truncation
      if (offloader) {
        try {
          const vfsResult = await offloader.offloadAsync(text, {
            threshold: effThreshold,
            headChars: effHeadChars,
            tailChars: effTailChars
          })
          newContent.push({
            ...part,
            output: {
              type: 'text',
              value: vfsResult.content
            } satisfies LanguageModelV3ToolResultOutput
          } satisfies LanguageModelV3ToolResultPart)
          continue
        } catch (error) {
          logger.warn(
            `[context] Storage adapter write failed for tool result (${part.toolCallId}). ` +
              `Falling back to simple truncation. Error: ${error instanceof Error ? error.message : String(error)}`
          )
          // Fall through to simple truncation below
        }
      }

      // Without storage: simple truncation, original is discarded
      const head = text.slice(0, effHeadChars)
      const tail = text.slice(text.length - effTailChars)
      const totalLines = text.split('\n').length

      const truncated = [head, `\n--- truncated (${totalLines} lines, ${text.length} chars total) ---\n`, tail]
        .filter(Boolean)
        .join('')
        .trim()

      newContent.push({
        ...part,
        output: { type: 'text', value: truncated } satisfies LanguageModelV3ToolResultOutput
      } satisfies LanguageModelV3ToolResultPart)
    }

    result.push({ ...msg, content: newContent })
  }

  return result
}

type ToolPolicy =
  | { preserve: true }
  | {
      preserve?: false
      threshold?: number
      headChars?: number
      tailChars?: number
      codec?: EntityToolOutputCodec
    }

/**
 * Entity-level trimming of one `json` tool-result part. Returns `null` when
 * the codec doesn't recognise the value (opaque fallback), the SAME part
 * reference when nothing needed trimming, or a new part whose output value has
 * oversized entity texts replaced by head/marker/tail (with storage) or the
 * inline `--- truncated ---` form (without). A per-blob storage failure keeps
 * that blob's full text — never trade data for a broken marker.
 */
async function truncateEntities(
  part: LanguageModelV3ToolResultPart,
  codec: EntityToolOutputCodec,
  budget: { threshold: number; headChars: number; tailChars: number },
  offloader: Offloader | null,
  logger: ContextLogger
): Promise<LanguageModelV3ToolResultPart | null> {
  const output = part.output as Extract<LanguageModelV3ToolResultOutput, { type: 'json' }>
  const deflated = codec.deflate(output.value)
  if (deflated === null) return null

  const texts: Record<string, string> = {}
  let anyTrimmed = false
  for (const blob of deflated.blobs) {
    const { key, text } = blob
    const overBudget = text.length > budget.threshold && budget.headChars + budget.tailChars < text.length
    // Never re-truncate an already-persisted marker (same guard as the opaque path).
    if (!overBudget || text.includes(PERSISTED_OUTPUT_TAG)) {
      texts[key] = text
      continue
    }
    if (offloader) {
      try {
        const vfsResult = await offloader.offloadAsync(text, {
          threshold: budget.threshold,
          headChars: budget.headChars,
          tailChars: budget.tailChars
        })
        texts[key] = vfsResult.content
        anyTrimmed = anyTrimmed || vfsResult.isOffloaded
        continue
      } catch (error) {
        logger.warn(
          `[context] Storage adapter write failed for entity ${key} of tool result (${part.toolCallId}). ` +
            `Keeping full text. Error: ${error instanceof Error ? error.message : String(error)}`
        )
        texts[key] = text
        continue
      }
    }
    const head = text.slice(0, budget.headChars)
    const tail = text.slice(text.length - budget.tailChars)
    const totalLines = text.split('\n').length
    texts[key] = [head, `\n--- truncated (${totalLines} lines, ${text.length} chars total) ---\n`, tail]
      .filter(Boolean)
      .join('')
      .trim()
    anyTrimmed = true
  }

  if (!anyTrimmed) return part
  return {
    ...part,
    output: { type: 'json', value: codec.assemble(deflated.skeleton, texts) } as LanguageModelV3ToolResultOutput
  } satisfies LanguageModelV3ToolResultPart
}

/**
 * Normalises `perTool` into a name → policy lookup.
 * Bare strings become `{ preserve: true }`; objects keep their partial overrides.
 * Last entry wins on duplicate names.
 */
function buildPolicyMap(perTool: TruncateOptions['perTool']): Map<string, ToolPolicy> {
  const map = new Map<string, ToolPolicy>()
  if (!perTool) return map
  for (const entry of perTool) {
    if (typeof entry === 'string') {
      map.set(entry, { preserve: true })
    } else {
      map.set(entry.name, {
        threshold: entry.threshold,
        headChars: entry.headChars,
        tailChars: entry.tailChars,
        codec: entry.codec
      })
    }
  }
  return map
}

function extractText(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value)
    case 'content':
      return output.value
        .map((v: { type: string; text?: string }) => (v.type === 'text' ? (v.text ?? '') : ''))
        .filter(Boolean)
        .join('\n')
    default:
      return ''
  }
}
