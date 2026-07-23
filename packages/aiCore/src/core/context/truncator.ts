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
import type { ContextLogger } from './types'

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

      const text = extractText(part.output)
      if (text.length <= effThreshold || effHeadChars + effTailChars >= text.length) {
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
        tailChars: entry.tailChars
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
