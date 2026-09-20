import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { buildCherryTopicFile, CHERRY_TOPIC_FILE_EXTENSION, type CherryTopicFile } from '@renderer/services/import'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import type { TreeResponse } from '@shared/data/types/message'

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
  return buildCherryTopicFile({
    topic,
    assistant: await fetchAssistantSnapshot(topic.assistantId),
    messages,
    activeNodeId: tree.activeNodeId,
    rootId: tree.rootId,
    exportedAt: new Date().toISOString()
  })
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
