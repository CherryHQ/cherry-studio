/**
 * Persist-time trimming of oversized tool outputs (#16786).
 *
 * Runs in the SQLite persistence backend just before the terminal
 * `finalizeAssistantMessage` write: tool-result parts whose text form exceeds
 * the context-build truncate threshold move their full text into FileManager
 * blobs (`toolOutputStore`) and keep only a `$persistedToolOutput` envelope
 * (excerpts + entry refs) in `message.data`. The `tool_output` file refs
 * written by the same finalize transaction tie the blobs' lifetimes to the
 * message.
 *
 * Lane rule (mirrors the in-flight middleware, `contextBuild.ts`): a registry
 * `codec` routes the output through entity-level trimming — each oversized
 * blobbed field moves to its own FileManager entry and the skeleton keeps a
 * snippet in its place — even when the tool is `truncatable: false` (that flag
 * only exempts the in-flight lane, where the active loop must see full text).
 * No codec + `truncatable: false` → skip; otherwise the whole-text v1 lane
 * applies. Thresholds, head/tail sizes, and line-snapping match the middleware
 * so markers rendered from the envelope are byte-identical to what the model
 * saw in-flight.
 */

import { computeHeadTailExcerpt } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { resolveContextSettings } from '@main/ai/contextBuild/resolveContextSettings'
import { resolveGlobalContextSettings } from '@main/ai/contextBuild/resolveRequestContextSettings'
import { extractPersistableText, persistToolOutputText, spliceTextAtKey } from '@main/ai/contextBuild/toolOutputStore'
import { registry } from '@main/ai/tools/adapters/aiSdk/registry'
import type { ToolEntry } from '@main/ai/tools/adapters/aiSdk/types'
import {
  isDeferredToolOutput,
  isPersistedToolOutput,
  PERSIST_HEAD_CHARS,
  PERSIST_TAIL_CHARS,
  type PersistedToolOutput,
  type PersistedToolOutputBlobRef,
  type PersistedToolOutputRef
} from '@shared/ai/transport'
import type { ContextSettingsOverride } from '@shared/data/types/contextSettings'
import type { CherryMessagePart } from '@shared/data/types/message'
import { getToolName, isToolUIPart } from 'ai'

const logger = loggerService.withContext('TrimToolOutputs')

/** Entity-level trim: blob every oversized deflated field, snippet it in the
 *  skeleton, and return the multi-blob envelope. `null` when the codec doesn't
 *  recognize the value or nothing crosses the threshold. */
async function trimViaCodec(
  output: unknown,
  codec: NonNullable<ToolEntry['codec']>,
  threshold: number
): Promise<PersistedToolOutputRef | null> {
  const deflated = codec.deflate(output)
  if (!deflated) return null
  const oversized = deflated.blobs.filter(
    (blob) => blob.text.length > threshold && PERSIST_HEAD_CHARS + PERSIST_TAIL_CHARS < blob.text.length
  )
  if (oversized.length === 0) return null

  const blobRefs: PersistedToolOutputBlobRef[] = []
  let skeleton = deflated.skeleton
  for (const blob of oversized) {
    const { entry, vfsFilename } = await persistToolOutputText(blob.text)
    const { head, tail, totalChars, totalLines } = computeHeadTailExcerpt(
      blob.text,
      PERSIST_HEAD_CHARS,
      PERSIST_TAIL_CHARS
    )
    blobRefs.push({ key: blob.key, fileEntryId: entry.id, vfsFilename, head, tail, totalChars, totalLines })
    skeleton = spliceTextAtKey(skeleton, blob.key, codec.snippet(blob.text))
  }
  return { shape: 'entities', skeleton, blobRefs }
}

/** Whole-text v1 trim: string / all-text MCP outputs move to a single blob. */
async function trimWholeText(output: unknown, threshold: number): Promise<PersistedToolOutputRef | null> {
  const extracted = extractPersistableText(output)
  if (!extracted) return null
  if (extracted.text.length <= threshold) return null
  if (PERSIST_HEAD_CHARS + PERSIST_TAIL_CHARS >= extracted.text.length) return null

  const { entry, vfsFilename } = await persistToolOutputText(extracted.text)
  const { head, tail, totalChars, totalLines } = computeHeadTailExcerpt(
    extracted.text,
    PERSIST_HEAD_CHARS,
    PERSIST_TAIL_CHARS
  )
  return {
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

/**
 * Replace oversized terminal tool outputs with persisted envelopes.
 * Returns the same array when nothing needed trimming. Storage failures are
 * per-part and non-fatal — the full output stays in the message data (never
 * trade real data for a marker).
 */
export async function trimOversizedToolOutputs(
  parts: CherryMessagePart[],
  assistantOverride?: ContextSettingsOverride | null
): Promise<CherryMessagePart[]> {
  // Same layering as the in-flight middleware's gate (`contextBuild.ts`):
  // persist-time globals + the turn's assistant override snapshot, so both
  // lanes trim at the same effective threshold.
  const settings = resolveContextSettings({ globals: resolveGlobalContextSettings(), assistant: assistantOverride })
  if (!settings.enabled) return parts
  const threshold = settings.truncateThreshold

  // MCP entries never register here, so the process-wide builtin registry is
  // the complete source of codecs and `truncatable: false` opt-outs.
  const builtins = new Map(registry.getAll().map((entry) => [entry.name, entry]))

  let trimmed: CherryMessagePart[] | undefined
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (!isToolUIPart(part) || part.state !== 'output-available') continue
    if (isPersistedToolOutput(part.output) || isDeferredToolOutput(part.output)) continue
    const entry = builtins.get(getToolName(part))
    if (!entry?.codec && entry?.truncatable === false) continue

    try {
      const ref = entry?.codec
        ? await trimViaCodec(part.output, entry.codec, threshold)
        : await trimWholeText(part.output, threshold)
      if (!ref) continue
      const output: PersistedToolOutput = { $persistedToolOutput: ref }
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
