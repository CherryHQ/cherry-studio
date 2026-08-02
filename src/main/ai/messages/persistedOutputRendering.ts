/**
 * Deterministic prompt rendering for `$persistedToolOutput` envelopes.
 *
 * A trimmed tool part carries only the excerpt + FileManager entry ref in
 * `message.data`; before `convertToModelMessages` runs, this pass rebuilds the
 * exact `<persisted-output>` marker the in-flight middleware would have
 * produced for the same content (same excerpt bytes, same `context://vfs/`
 * URI, same physical path) — so the prompt bytes are stable across requests
 * and provider prefix caches hold.
 *
 * Shape-aware: a `'text'` envelope renders to a plain marker string (the AI
 * SDK's default string→text conversion), an `'mcp-content'` envelope renders
 * to an MCP result whose single text block is the marker (so the MCP tool's
 * `toModelOutput` summarization emits the marker verbatim). Parts keep state
 * `'output-available'` so `ignoreIncompleteToolCalls` never drops them.
 */

import { application } from '@application'
import { ContextPrompts } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { isPersistedToolOutput, type PersistedToolOutputRef } from '@shared/ai/transport'
import type { UIMessage } from 'ai'
import { isToolUIPart } from 'ai'

const logger = loggerService.withContext('PersistedOutputRendering')

function renderMarker(ref: PersistedToolOutputRef): string {
  let physicalPath: string | null = null
  try {
    physicalPath = application.get('FileManager').getPhysicalPath(ref.fileEntryId)
  } catch (error) {
    // Entry gone (manual surgery / backup restore) — the model still sees the
    // head/tail; fs_read read-back is simply unavailable for this output.
    logger.warn('persisted output entry unresolvable; rendering marker without a path', {
      fileEntryId: ref.fileEntryId,
      error: (error as Error).message
    })
  }
  return ContextPrompts.getVFSOffloadReminder(
    `context://vfs/${ref.vfsFilename}`,
    ref.totalLines,
    ref.totalChars,
    ref.head,
    ref.tail,
    physicalPath
  )
}

/**
 * Absolute paths of every persisted blob referenced by these messages — the
 * seed of `RequestContext.persistedOutputPaths` (fs_read's exact allow-list).
 * Unresolvable entries are skipped: their markers render path-less too, so
 * the model is never handed a path the allow-list would then deny.
 */
export function collectPersistedOutputPaths(messages: UIMessage[]): Set<string> {
  const paths = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part) || part.state !== 'output-available' || !isPersistedToolOutput(part.output)) continue
      const ref = part.output.$persistedToolOutput
      try {
        paths.add(application.get('FileManager').getPhysicalPath(ref.fileEntryId))
      } catch {
        // Entry gone — renderMarker logs it; nothing to allow.
      }
    }
  }
  return paths
}

/** Replace persisted envelopes with rendered markers. Reference-preserving when nothing changes. */
export function renderPersistedToolOutputs<T extends UIMessage>(messages: T[]): T[] {
  let out: T[] | undefined
  messages.forEach((message, messageIndex) => {
    let parts: T['parts'] | undefined
    message.parts.forEach((part, partIndex) => {
      if (!isToolUIPart(part) || part.state !== 'output-available' || !isPersistedToolOutput(part.output)) return
      const ref = part.output.$persistedToolOutput
      const marker = renderMarker(ref)
      const output =
        ref.shape === 'mcp-content'
          ? {
              content: [{ type: 'text', text: marker }],
              ...(ref.metadata !== undefined ? { metadata: ref.metadata } : {})
            }
          : marker
      parts ??= [...message.parts]
      parts[partIndex] = { ...part, output }
    })
    if (parts) {
      out ??= [...messages]
      out[messageIndex] = { ...message, parts }
    }
  })
  return out ?? messages
}
