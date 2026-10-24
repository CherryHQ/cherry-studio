import { fileURLToPath } from 'node:url'

import { isAbortError } from '@ai-sdk/provider-utils'

import { application } from '@application'
import { NonNativeMediaAnalysisError } from '@main/ai/messages/mediaAnalysisRequestError'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

function fileParts(message: AgentSessionMessageEntity): FileUIPart[] {
  return (message.data?.parts ?? []).filter((part): part is FileUIPart => part.type === 'file')
}

function isAudioOrVideoFilePart(part: FileUIPart): boolean {
  const mediaType = part.mediaType?.toLowerCase() ?? ''
  if (mediaType.startsWith('audio/') || mediaType.startsWith('video/')) return true
  const filename = part.filename ?? ''
  const extension = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1) : ''
  const fileType = getFileTypeByExt(extension)
  return fileType === 'audio' || fileType === 'video'
}

/** True when the user turn includes an audio or video attachment that should be analyzed first. */
export function hasAgentMediaAttachment(message: AgentSessionMessageEntity): boolean {
  return fileParts(message).some(isAudioOrVideoFilePart)
}

/**
 * Compact analysis blocks for audio and video on an agent user turn.
 * The original path or read handle stays in the prompt separately.
 * A failed, unusable, or aborted analysis stops the turn before the next attachment starts.
 */
export async function collectAgentMediaNotes(
  message: AgentSessionMessageEntity,
  signal?: AbortSignal
): Promise<string[]> {
  const notes: string[] = []
  for (const part of fileParts(message)) {
    if (!isAudioOrVideoFilePart(part)) continue
    signal?.throwIfAborted()
    const name = part.filename?.trim() || 'file'
    const entryId = readCherryMeta(part)?.fileEntryId
    try {
      const file = entryId
        ? { kind: 'entry' as const, entryId }
        : part.url?.startsWith('file://')
          ? { kind: 'path' as const, path: AbsoluteFilePathSchema.parse(fileURLToPath(part.url)) }
          : null
      if (!file) throw new NonNativeMediaAnalysisError()
      const text = await application.get('MediaAnalysisService').analyzeToCompactText(file, signal)
      signal?.throwIfAborted()
      notes.push(`Attached file "${name}":\n${text}`)
    } catch (error) {
      signal?.throwIfAborted()
      if (isAbortError(error) || error instanceof NonNativeMediaAnalysisError) throw error
      throw new NonNativeMediaAnalysisError()
    }
  }
  return notes
}
