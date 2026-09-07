import { application } from '@application'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { fileEntryService } from '@data/services/FileEntryService'
import { messageService } from '@data/services/MessageService'
import { loggerService } from '@logger'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { inflateEntities, isToolOutputBlobEntry, reconstructOutput } from '@main/ai/contextBuild/toolOutputStore'
import type { AiToolResultResponse, PersistedToolOutput, PersistedToolOutputBlobRef } from '@shared/ai/transport'
import { blobRefsOf, isPersistedToolOutput } from '@shared/ai/transport'
import { isToolUIPart } from 'ai'

const logger = loggerService.withContext('ai:persistedToolOutput')

export async function findPersistedToolOutput(
  topicId: string,
  messageId: string,
  toolCallId: string
): Promise<AiToolResultResponse> {
  try {
    const parts = isAgentSessionTopic(topicId)
      ? agentSessionMessageService.getSessionMessage(extractAgentSessionId(topicId), messageId).data.parts
      : messageService.getById(messageId).data.parts
    for (const part of parts ?? []) {
      if (!isToolUIPart(part) || part.state !== 'output-available') continue
      if (part.toolCallId !== toolCallId) continue
      if (isPersistedToolOutput(part.output)) {
        return { found: true, output: await resolvePersistedToolOutput(part.output) }
      }
      return { found: true, output: part.output }
    }
  } catch (error) {
    // Preserve ai.tool.get_result's miss contract; readable envelopes can still
    // degrade to an excerpt when their blob is unavailable.
    logger.warn('persisted tool result lookup failed', { topicId, messageId, toolCallId, error })
  }
  return { found: false }
}

async function resolvePersistedToolOutput(output: PersistedToolOutput): Promise<unknown> {
  const ref = output.$persistedToolOutput
  const readBlob = async (blob: PersistedToolOutputBlobRef): Promise<string> => {
    try {
      const entry = fileEntryService.findById(blob.fileEntryId)
      if (!entry || !isToolOutputBlobEntry(entry)) throw new Error('entry is not a persisted tool-output blob')
      const { content } = await application.get('FileManager').read(blob.fileEntryId, { encoding: 'text' })
      return content
    } catch (error) {
      logger.warn('persisted tool output unavailable, serving excerpt', { fileEntryId: blob.fileEntryId, error })
      return `${blob.head}\n\n[persisted output no longer available — showing excerpt of ${blob.totalChars} chars]\n\n${blob.tail}`
    }
  }
  if (ref.shape === 'entities') {
    const texts = Object.fromEntries(
      await Promise.all(ref.blobRefs.map(async (blob) => [blob.key, await readBlob(blob)] as const))
    )
    return inflateEntities(ref, texts)
  }
  return reconstructOutput(ref, await readBlob(blobRefsOf(ref)[0]))
}
