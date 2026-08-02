/**
 * Persist-time trimming of oversized tool outputs (#16786).
 *
 * Runs in the SQLite persistence backend just before the terminal
 * `finalizeAssistantMessage` write: tool-result parts whose text form exceeds
 * the context-build truncate threshold move their full text into a
 * FileManager blob (`toolOutputStore`) and keep only a `$persistedToolOutput`
 * envelope (head/tail excerpt + entry ref) in `message.data`. The
 * `tool_output` file ref written by the same finalize transaction ties the
 * blob's lifetime to the message.
 *
 * Mirrors the in-flight middleware's policy (same threshold pref, same
 * `truncatable: false` exemptions, same head/tail sizes and line-snapping) so
 * the marker later rendered from the envelope is byte-identical to what the
 * middleware showed the model in-flight.
 */

import { application } from '@application'
import { computeHeadTailExcerpt } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { extractPersistableText, persistToolOutputText } from '@main/ai/contextBuild/toolOutputStore'
import { registry } from '@main/ai/tools/adapters/aiSdk/registry'
import {
  isDeferredToolOutput,
  isPersistedToolOutput,
  PERSIST_HEAD_CHARS,
  PERSIST_TAIL_CHARS,
  type PersistedToolOutput
} from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'
import { getToolName, isToolUIPart } from 'ai'

const logger = loggerService.withContext('TrimToolOutputs')

/**
 * Replace oversized terminal tool outputs with persisted envelopes.
 * Returns the same array when nothing needed trimming. Storage failures are
 * per-part and non-fatal — the full output stays in the message data (never
 * trade real data for a marker).
 */
export async function trimOversizedToolOutputs(parts: CherryMessagePart[]): Promise<CherryMessagePart[]> {
  const prefs = application.get('PreferenceService')
  // Symmetric with the in-flight middleware's gate (`contextBuild.ts`).
  if (!prefs.get('chat.context_settings.enabled')) return parts
  const threshold = prefs.get('chat.context_settings.truncate_threshold')

  // Same declarative opt-out the middleware applies (`truncatable: false` —
  // citation + read-style tools). MCP entries never set the flag, so the
  // process-wide builtin registry is the complete source.
  const neverTruncate = new Set(
    registry
      .getAll()
      .filter((entry) => entry.truncatable === false)
      .map((entry) => entry.name)
  )

  let trimmed: CherryMessagePart[] | undefined
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (!isToolUIPart(part) || part.state !== 'output-available') continue
    if (isPersistedToolOutput(part.output) || isDeferredToolOutput(part.output)) continue
    if (neverTruncate.has(getToolName(part))) continue

    const extracted = extractPersistableText(part.output)
    if (!extracted) continue
    if (extracted.text.length <= threshold) continue
    if (PERSIST_HEAD_CHARS + PERSIST_TAIL_CHARS >= extracted.text.length) continue

    try {
      const { entry, vfsFilename } = await persistToolOutputText(extracted.text)
      const { head, tail, totalChars, totalLines } = computeHeadTailExcerpt(
        extracted.text,
        PERSIST_HEAD_CHARS,
        PERSIST_TAIL_CHARS
      )
      const output: PersistedToolOutput = {
        $persistedToolOutput: {
          fileEntryId: entry.id,
          vfsFilename,
          head,
          tail,
          totalChars,
          totalLines,
          shape: extracted.shape,
          ...(extracted.metadata !== undefined ? { metadata: extracted.metadata } : {})
        }
      }
      trimmed ??= [...parts]
      trimmed[index] = { ...part, output } as CherryMessagePart
    } catch (error) {
      logger.error('tool-output trim failed; keeping the full output in message data', error as Error, {
        toolCallId: part.toolCallId
      })
    }
  }
  return trimmed ?? parts
}
