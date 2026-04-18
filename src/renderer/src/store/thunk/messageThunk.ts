/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING
 * --------------------------------------------------------------------------
 * This file is being phased out. It now contains only the legacy thunks still
 * referenced by V2 surfaces that have not yet been migrated:
 *   - loadTopicMessagesThunk (history + sessions + topic switch)
 *   - renameAgentSessionIfNeeded (agent session auto-rename)
 *   - removeBlocksThunk (pinned todo block cleanup)
 *
 * All V1 chat streaming entry points (sendMessage, resendMessageThunk,
 * regenerateAssistantResponseThunk, initiateTranslationThunk, the IM channel
 * stream helpers, etc.) have been removed together with the BlockManager /
 * StreamingService / AiSdkToChunkAdapter pipeline. V2 uses useChat +
 * IpcChatTransport + Main-side PersistenceListener instead.
 * --------------------------------------------------------------------------
 */
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { AgentApiClient } from '@renderer/api/agent'
import db from '@renderer/databases'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { dbService } from '@renderer/services/db/DbService'
import FileManager from '@renderer/services/FileManager'
import { updateTopicUpdatedAt } from '@renderer/store/assistants'
import type { ApiServerConfig, FileMetadata } from '@renderer/types'
import type { AgentSessionEntity, GetAgentSessionResponse } from '@renderer/types/agent'
import { MessageBlockType } from '@renderer/types/newMessage'
import { isAgentSessionTopicId } from '@renderer/utils/agentSession'
import { isEmpty } from 'lodash'
import { mutate } from 'swr'

import type { AppDispatch, RootState } from '../index'
import { removeManyBlocks, upsertManyBlocks } from '../messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '../newMessage'

const logger = loggerService.withContext('MessageThunk')

// ---------------------------------------------------------------------------
// Agent session rename
// ---------------------------------------------------------------------------

type AgentSessionContext = {
  agentId: string
  sessionId: string
}

const agentSessionRenameLocks = new Set<string>()

const buildAgentBaseURL = (apiServer: ApiServerConfig) => {
  const hasProtocol = apiServer.host.startsWith('http://') || apiServer.host.startsWith('https://')
  const baseHost = hasProtocol ? apiServer.host : `http://${apiServer.host}`
  const portSegment = apiServer.port ? `:${apiServer.port}` : ''
  return `${baseHost}${portSegment}`
}

const getAgentApiServerConfig = async (): Promise<ApiServerConfig | null> => {
  const { host, port, apiKey } = await preferenceService.getMultiple({
    host: 'feature.csaas.host',
    port: 'feature.csaas.port',
    apiKey: 'feature.csaas.api_key'
  })

  if (!apiKey) {
    return null
  }

  return {
    enabled: true,
    host,
    port,
    apiKey
  }
}

const createAgentApiHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'X-Api-Key': apiKey
})

const createAgentApiClient = async (): Promise<AgentApiClient | null> => {
  const apiServer = await getAgentApiServerConfig()
  if (!apiServer?.apiKey) {
    return null
  }

  return new AgentApiClient({
    baseURL: buildAgentBaseURL(apiServer),
    headers: createAgentApiHeaders(apiServer.apiKey)
  })
}

const updateRenamedAgentSessionCache = async (
  client: AgentApiClient,
  agentId: string,
  updatedSession: GetAgentSessionResponse
): Promise<void> => {
  const paths = client.getSessionPaths(agentId)

  await mutate(paths.withId(updatedSession.id), updatedSession, {
    revalidate: false
  })

  await mutate<AgentSessionEntity[]>(
    paths.base,
    (prev) =>
      prev?.map((sessionItem) =>
        sessionItem.id === updatedSession.id
          ? ({
              ...sessionItem,
              name: updatedSession.name
            } as AgentSessionEntity)
          : sessionItem
      ) ?? prev,
    {
      revalidate: false
    }
  )
}

export const renameAgentSessionIfNeeded = async (agentSession: AgentSessionContext, topicId: string): Promise<void> => {
  const lockId = `${agentSession.agentId}:${agentSession.sessionId}`
  if (agentSessionRenameLocks.has(lockId)) {
    return
  }

  try {
    const client = await createAgentApiClient()
    if (!client) {
      return
    }

    const { messages } = await dbService.fetchMessages(topicId, true)
    if (!messages.length) {
      return
    }

    const { text: summary } = await fetchMessagesSummary({ messages })
    const summaryText = summary?.trim()
    if (!summaryText) {
      return
    }

    agentSessionRenameLocks.add(lockId)

    let session: GetAgentSessionResponse
    try {
      session = await client.getSession(agentSession.agentId, agentSession.sessionId)
    } catch (error) {
      logger.warn('Failed to fetch agent session for rename', error as Error)
      return
    }

    const currentName = (session.name ?? '').trim()
    if (currentName === summaryText) {
      return
    }

    let updatedSession: GetAgentSessionResponse
    try {
      updatedSession = await client.updateSession(agentSession.agentId, {
        id: agentSession.sessionId,
        name: summaryText
      })
    } catch (error) {
      logger.warn('Failed to update agent session name', error as Error)
      return
    }

    try {
      await updateRenamedAgentSessionCache(client, agentSession.agentId, updatedSession)
    } catch (error) {
      logger.warn('Failed to update agent session cache after rename', error as Error)
    }
  } catch (error) {
    logger.warn('Unexpected error during agent session rename', error as Error)
  } finally {
    agentSessionRenameLocks.delete(lockId)
  }
}

// ---------------------------------------------------------------------------
// Topic message loading
// ---------------------------------------------------------------------------

/**
 * Load messages for a topic via DbService and publish them into Redux.
 *
 * Still used by:
 *   - useTopic (topic switch)
 *   - useSessionChanged (agent session switch)
 *   - HistoryPage (jump to message)
 *   - SessionItem (agent session refresh)
 */
export const loadTopicMessagesThunk =
  (topicId: string, forceReload: boolean = false) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()

    dispatch(newMessagesActions.setCurrentTopicId(topicId))

    if (!forceReload && state.messages.messageIdsByTopic[topicId]) {
      return
    }

    try {
      const { messages, blocks } = await dbService.fetchMessages(topicId)

      logger.silly('Loaded messages via DbService', {
        topicId,
        messageCount: messages.length,
        blockCount: blocks.length
      })

      if (blocks.length > 0) {
        dispatch(upsertManyBlocks(blocks))
      }
      dispatch(newMessagesActions.messagesReceived({ topicId, messages }))
    } catch (error) {
      logger.error(`Failed to load messages for topic ${topicId}:`, error as Error)
    }
  }

// ---------------------------------------------------------------------------
// Block removal (pinned todo panel)
// ---------------------------------------------------------------------------

const cleanupBlockFilesAndRedux = async (dispatch: AppDispatch, blockIds: string[]) => {
  if (blockIds.length === 0) {
    return
  }

  try {
    const blocks = await db.message_blocks.where('id').anyOf(blockIds).toArray()
    const files = blocks
      .filter((block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE)
      .map((block) => block.file)
      .filter((file): file is FileMetadata => file !== undefined)

    if (!isEmpty(files)) {
      await Promise.all(files.map((file) => FileManager.deleteFile(file.id, false)))
    }
  } catch (error) {
    logger.warn('Failed to cleanup block files', error as Error)
  }

  dispatch(removeManyBlocks(blockIds))
}

export const removeBlocksThunk =
  (topicId: string, messageId: string, blockIdsToRemove: string[]) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    if (!blockIdsToRemove.length) {
      logger.warn('[removeBlocksThunk] No block IDs provided to remove.')
      return
    }

    try {
      const state = getState()
      const message = state.messages.entities[messageId]

      if (!message) {
        logger.error(`[removeBlocksThunk] Message ${messageId} not found in state.`)
        return
      }
      const blockIdsToRemoveSet = new Set(blockIdsToRemove)

      const updatedBlockIds = (message.blocks || []).filter((id) => !blockIdsToRemoveSet.has(id))

      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId,
          updates: { blocks: updatedBlockIds }
        })
      )
      await cleanupBlockFilesAndRedux(dispatch, blockIdsToRemove)

      if (isAgentSessionTopicId(topicId)) {
        await dbService.updateMessage(topicId, messageId, {
          blocks: updatedBlockIds
        })
      } else {
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.transaction('rw', db.topics, db.message_blocks, async () => {
          await db.topics.update(topicId, { messages: finalMessagesToSave })
          if (blockIdsToRemove.length > 0) {
            await db.message_blocks.bulkDelete(blockIdsToRemove)
          }
        })
      }

      dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`[removeBlocksThunk] Failed to remove blocks from message ${messageId}:`, error as Error)
      throw error
    }
  }
