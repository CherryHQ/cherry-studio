/**
 * Chat-path attachment prep. In ONE pass over each message's parts, every file
 * part is either:
 *   - stripped into a `read_file` manifest entry — when the model can call
 *     tools and the part is a first-party attachment (`fileEntryId` present),
 *     so the bytes are pulled lazily instead of inlined every turn; or
 *   - inlined as a base64 data URL via `resolveFileUIPart` — everything else
 *     (legacy `file://` parts, or any file part when the model can't call
 *     tools, which keeps the old eager behaviour).
 *
 * `collectFileAttachments` exposes the per-request allow-list the `read_file`
 * tool resolves filenames against (threaded into RequestContext by
 * `buildAgentParams`); the model never sees the internal `fileEntryId`.
 *
 * Chat-only by construction: gateway / external file parts have no
 * `fileEntryId`, so they are never stripped and stay on the eager-inline path.
 */

import { loggerService } from '@logger'
import type { FileAttachmentRef } from '@main/ai/tools/adapters/aiSdk/context'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import type { UIMessage } from 'ai'

import { resolveFileUIPart } from './fileProcessor'

const logger = loggerService.withContext('ai:attachmentManifest')

function toAttachmentRef(part: FileUIPart, fileEntryId: string): FileAttachmentRef {
  return {
    fileEntryId,
    filename: part.filename ?? 'file',
    mediaType: part.mediaType ?? 'application/octet-stream'
  }
}

/**
 * Flat allow-list of fileEntry-backed attachments across all messages — the set
 * `read_file` may resolve a filename against.
 */
export function collectFileAttachments(messages: UIMessage[] | undefined): FileAttachmentRef[] {
  const refs: FileAttachmentRef[] = []
  for (const message of messages ?? []) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'file') continue
      const fileEntryId = readCherryMeta(part)?.fileEntryId
      if (fileEntryId) refs.push(toAttachmentRef(part, fileEntryId))
    }
  }
  return refs
}

function renderManifest(refs: FileAttachmentRef[]): string {
  const lines = refs.map((r) => `- ${r.filename} (${r.mediaType})`)
  return `Attached file(s) — call read_file with the file's name to read its content:\n${lines.join('\n')}`
}

async function prepareChatMessage<T extends UIMessage>(message: T, enableManifest: boolean): Promise<T> {
  if (!message.parts?.length) return message

  const refs: FileAttachmentRef[] = []
  const kept: UIMessage['parts'] = []
  for (const part of message.parts) {
    if (part.type !== 'file') {
      kept.push(part as UIMessage['parts'][number])
      continue
    }
    const fileEntryId = enableManifest ? readCherryMeta(part)?.fileEntryId : undefined
    if (fileEntryId) {
      // Pulled lazily via read_file — drop the bytes from the prompt.
      refs.push(toAttachmentRef(part, fileEntryId))
      continue
    }
    // Eager-inline: legacy file:// parts, or any file when tools are unavailable.
    const inlined = await resolveFileUIPart(part)
    if (inlined) kept.push(inlined as UIMessage['parts'][number])
    else logger.warn('Dropped unresolved file part', { messageId: message.id })
  }

  if (refs.length) kept.push({ type: 'text', text: renderManifest(refs) } as UIMessage['parts'][number])
  return { ...message, parts: kept } as T
}

/**
 * Prepare chat messages for the model: per file part, strip it into a read_file
 * manifest (when `enableManifest`) or inline its bytes. Single pass replacing
 * the prior manifest-strip + separate inline.
 */
export async function prepareChatMessages<T extends UIMessage = UIMessage>(
  messages: T[],
  enableManifest: boolean
): Promise<T[]> {
  return Promise.all(messages.map((message) => prepareChatMessage(message, enableManifest)))
}
