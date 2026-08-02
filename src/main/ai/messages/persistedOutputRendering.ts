/**
 * Deterministic prompt rendering for `$persistedToolOutput` envelopes.
 *
 * A trimmed tool part carries only excerpts + FileManager entry refs in
 * `message.data`; before `convertToModelMessages` runs, this pass rebuilds the
 * exact `<persisted-output>` markers the in-flight middleware would have
 * produced for the same content (same excerpt bytes, same `context://vfs/`
 * URI, same physical path) — so the prompt bytes are stable across requests
 * and provider prefix caches hold.
 *
 * Shape-aware: a `'text'` envelope renders to a plain marker string (the AI
 * SDK's default string→text conversion), an `'mcp-content'` envelope renders
 * to an MCP result whose single text block is the marker (so the MCP tool's
 * `toModelOutput` summarization emits the marker verbatim), and an
 * `'entities'` envelope splices a per-blob marker into each blobbed skeleton
 * field — byte-identical to what the in-flight entity codec assembles. Parts
 * keep state `'output-available'` so `ignoreIncompleteToolCalls` never drops
 * them.
 */

import { application } from '@application'
import { ContextPrompts } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { spliceTextAtKey } from '@main/ai/contextBuild/toolOutputStore'
import {
  blobRefsOf,
  isPersistedToolOutput,
  type PersistedToolOutputBlobRef,
  type PersistedToolOutputRef
} from '@shared/ai/transport'
import type { UIMessage } from 'ai'
import { isToolUIPart } from 'ai'

const logger = loggerService.withContext('PersistedOutputRendering')

function renderMarkerForBlob(blob: PersistedToolOutputBlobRef): string {
  let physicalPath: string | null = null
  try {
    physicalPath = application.get('FileManager').getPhysicalPath(blob.fileEntryId)
  } catch (error) {
    // Entry gone (manual surgery / backup restore) — the model still sees the
    // head/tail; fs_read read-back is simply unavailable for this output.
    logger.warn('persisted output entry unresolvable; rendering marker without a path', {
      fileEntryId: blob.fileEntryId,
      error: (error as Error).message
    })
  }
  return ContextPrompts.getVFSOffloadReminder(
    `context://vfs/${blob.vfsFilename}`,
    blob.totalLines,
    blob.totalChars,
    blob.head,
    blob.tail,
    physicalPath
  )
}

function renderOutput(ref: PersistedToolOutputRef): unknown {
  if (ref.shape === 'entities') {
    let value = ref.skeleton
    for (const blob of ref.blobRefs) {
      value = spliceTextAtKey(value, blob.key, renderMarkerForBlob(blob))
    }
    return value
  }
  const marker = renderMarkerForBlob(blobRefsOf(ref)[0])
  if (ref.shape === 'mcp-content') {
    return {
      content: [{ type: 'text', text: marker }],
      ...(ref.metadata !== undefined ? { metadata: ref.metadata } : {})
    }
  }
  return marker
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
      for (const blob of blobRefsOf(part.output.$persistedToolOutput)) {
        try {
          paths.add(application.get('FileManager').getPhysicalPath(blob.fileEntryId))
        } catch {
          // Entry gone — renderMarkerForBlob logs it; nothing to allow.
        }
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
      const output = renderOutput(part.output.$persistedToolOutput)
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
