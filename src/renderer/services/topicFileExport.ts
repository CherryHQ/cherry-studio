import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { buildCherryTopicFile, CHERRY_TOPIC_FILE_EXTENSION, type CherryTopicFile } from '@renderer/services/import'
import { MAX_EMBED_IMAGE_BYTES } from '@renderer/services/markdownImageExport'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import type { TreeResponse } from '@shared/data/types/message'
import { AbsoluteFilePathSchema, type FileUrlString } from '@shared/types/file'
import { createFilePathHandle, fileUrlToPath } from '@shared/utils/file'

const logger = loggerService.withContext('TopicFileExport')

// The concrete tree path reverse-matches several schema routes, so the client
// types the response as a union; narrow it before use.
function isTreeResponse(value: unknown): value is TreeResponse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { nodes?: unknown; siblingsGroups?: unknown }
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.siblingsGroups)
}

async function fetchAssistantSnapshot(
  assistantId: string | undefined
): Promise<{ name: string; emoji?: string } | undefined> {
  if (!assistantId) return undefined
  try {
    const assistant = await dataApiService.get(`/assistants/${assistantId}`)
    return { name: assistant.name, ...(assistant.emoji ? { emoji: assistant.emoji } : {}) }
  } catch {
    return undefined
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

interface InlineResult {
  parts: unknown[]
  skipped: number
}

// Base64 payload decodes to ~3 bytes per 4 chars; other data urls are measured
// by payload length. Both over-estimate slightly, which is fine for a cap check.
function estimatedDataUrlBytes(url: string): number {
  const comma = url.indexOf(',')
  const payload = comma >= 0 ? url.slice(comma + 1) : ''
  if (comma >= 0 && url.slice(0, comma).endsWith(';base64')) {
    return Math.floor((payload.length * 3) / 4)
  }
  return payload.length
}

// Rewrite `file://` attachment urls as `data:` urls so the topic file stays
// self-contained across installs. Over-limit or unreadable attachments are
// dropped and counted so the caller can say so instead of losing them silently.
async function inlineLocalAttachments(parts: unknown[]): Promise<InlineResult> {
  const rewritten: unknown[] = []
  let skipped = 0
  for (const part of parts) {
    if (typeof part !== 'object' || part === null || (part as { type?: unknown }).type !== 'file') {
      rewritten.push(part)
      continue
    }
    const filePart = part as { url?: unknown; mediaType?: unknown }
    if (typeof filePart.url !== 'string') {
      rewritten.push(part)
      continue
    }
    // Already-embedded payloads count against the same cap as inlined files.
    if (filePart.url.startsWith('data:')) {
      if (estimatedDataUrlBytes(filePart.url) > MAX_EMBED_IMAGE_BYTES) {
        skipped += 1
        continue
      }
      rewritten.push(part)
      continue
    }
    if (!filePart.url.startsWith('file://')) {
      rewritten.push(part)
      continue
    }
    try {
      const path = AbsoluteFilePathSchema.parse(fileUrlToPath(filePart.url as FileUrlString))
      const metadata = await ipcApi.request('file.get_metadata', createFilePathHandle(path))
      if (metadata?.kind === 'file' && metadata.size > MAX_EMBED_IMAGE_BYTES) {
        skipped += 1
        continue
      }
      const { content, mime } = await ipcApi.request('file.read', {
        handle: createFilePathHandle(path),
        options: { mode: 'full', encoding: 'binary' }
      })
      if (content.length > MAX_EMBED_IMAGE_BYTES) {
        skipped += 1
        continue
      }
      rewritten.push({ ...filePart, url: `data:${mime};base64,${bytesToBase64(content)}`, mediaType: mime })
    } catch (error) {
      skipped += 1
      logger.warn('Dropped an unreadable attachment from the topic file export', { error })
    }
  }
  return { parts: rewritten, skipped }
}

export async function collectTopicFileData(topicId: string): Promise<CherryTopicFile> {
  const topic = await dataApiService.get(`/topics/${topicId}`)
  const treeResponse = await dataApiService.get(`/topics/${topicId}/tree`, {
    query: { depth: -1 }
  })
  if (!isTreeResponse(treeResponse)) {
    throw new Error('Unexpected topic tree response')
  }
  const tree = treeResponse
  const nodeIds = [...tree.nodes.map((node) => node.id)]
  for (const group of tree.siblingsGroups) {
    nodeIds.push(...group.nodes.map((node) => node.id))
  }
  const messages = await Promise.all(nodeIds.map((id) => dataApiService.get(`/messages/${id}`)))
  const file = buildCherryTopicFile({
    topic,
    assistant: await fetchAssistantSnapshot(topic.assistantId),
    messages,
    activeNodeId: tree.activeNodeId,
    rootId: tree.rootId,
    exportedAt: new Date().toISOString()
  })
  let skippedAttachments = 0
  for (const message of file.messages) {
    const inlined = await inlineLocalAttachments(message.parts)
    message.parts = inlined.parts
    skippedAttachments += inlined.skipped
  }
  if (skippedAttachments > 0) {
    logger.warn('Skipped unreadable attachments during topic file export', { skippedAttachments })
    toast.warning(i18n.t('chat.topics.export.topic_file_skipped_attachments', { count: skippedAttachments }))
  }
  return file
}

export async function exportTopicAsFile(topic: Topic): Promise<void> {
  try {
    const file = await collectTopicFileData(topic.id)
    const fileName = `${removeSpecialCharactersForFileName(topic.name) || 'topic'}${CHERRY_TOPIC_FILE_EXTENSION}`
    const savedPath = await window.api.file.save(fileName, JSON.stringify(file, null, 2))
    if (savedPath) {
      toast.success(i18n.t('chat.topics.export.topic_file_saved'))
    }
  } catch (error) {
    logger.error('Failed to export topic file:', error as Error)
    toast.error(i18n.t('chat.topics.export.failed'))
  }
}
