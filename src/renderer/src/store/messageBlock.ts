/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import type { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import type OpenAI from '@cherrystudio/openai'
import type { GroundingMetadata } from '@google/genai'
import { createEntityAdapter, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { TodoItem, TodoWriteToolInput } from '@renderer/pages/home/Messages/Tools/MessageAgentTools/types'
import type {
  AISDKWebSearchResult,
  BaseTool,
  Citation,
  NormalToolResponse,
  WebSearchProviderResponse
} from '@renderer/types'
import { WebSearchSource } from '@renderer/types'
import type { CitationMessageBlock, MessageBlock, ToolMessageBlock } from '@renderer/types/newMessage'
import { MESSAGE_BLOCK_TYPE } from '@renderer/types/newMessage'

import type { RootState } from './index' // 确认 RootState 从 store/index.ts 导出

// Create a simplified type for the entity adapter to avoid circular type issues
type MessageBlockEntity = MessageBlock

// 1. 创建实体适配器 (Entity Adapter)
// 我们使用块的 `id` 作为唯一标识符。
const messageBlocksAdapter = createEntityAdapter<MessageBlockEntity>()

// 2. 使用适配器定义初始状态 (Initial State)
// 如果需要，可以在规范化实体的旁边添加其他状态属性。
const initialState = messageBlocksAdapter.getInitialState({
  loadingState: 'idle' as 'idle' | 'loading' | 'succeeded' | 'failed',
  error: null as string | null
})

// 3. 创建 Slice
// @ts-ignore ignore
export const messageBlocksSlice = createSlice({
  name: 'messageBlocks',
  initialState,
  reducers: {
    // 使用适配器的 reducer 助手进行 CRUD 操作。
    // 这些 reducer 会自动处理规范化的状态结构。

    /** 添加或更新单个块 (Upsert)。 */
    upsertOneBlock: messageBlocksAdapter.upsertOne, // 期望 MessageBlock 作为 payload

    /** 添加或更新多个块。用于加载消息。 */
    upsertManyBlocks: messageBlocksAdapter.upsertMany, // 期望 MessageBlock[] 作为 payload

    /** 根据 ID 移除单个块。 */
    removeOneBlock: messageBlocksAdapter.removeOne, // 期望 EntityId (string) 作为 payload

    /** 根据 ID 列表移除多个块。用于清理话题。 */
    removeManyBlocks: messageBlocksAdapter.removeMany, // 期望 EntityId[] (string[]) 作为 payload

    /** 移除所有块。用于完全重置。 */
    removeAllBlocks: messageBlocksAdapter.removeAll,

    // 你可以为其他状态属性（如加载/错误）添加自定义 reducer
    setMessageBlocksLoading: (state, action: PayloadAction<'idle' | 'loading'>) => {
      state.loadingState = action.payload
      state.error = null
    },
    setMessageBlocksError: (state, action: PayloadAction<string>) => {
      state.loadingState = 'failed'
      state.error = action.payload
    },
    // 注意：如果只想更新现有块，也可以使用 `updateOne`
    updateOneBlock: messageBlocksAdapter.updateOne // 期望 { id: EntityId, changes: Partial<MessageBlock> }
  }
  // 如果需要处理其他 slice 的 action，可以在这里添加 extraReducers。
})

// 4. 导出 Actions 和 Reducer
export const {
  upsertOneBlock,
  upsertManyBlocks,
  removeOneBlock,
  removeManyBlocks,
  removeAllBlocks,
  setMessageBlocksLoading,
  setMessageBlocksError,
  updateOneBlock
} = messageBlocksSlice.actions

export const messageBlocksSelectors = messageBlocksAdapter.getSelectors<RootState>(
  (state) => state.messageBlocks // Ensure this matches the key in the root reducer
)

// --- Selector Integration --- START

// Selector to get the raw block entity by ID
const selectBlockEntityById = (state: RootState, blockId: string | undefined): MessageBlock | undefined => {
  const entity = blockId ? messageBlocksSelectors.selectById(state, blockId) : undefined
  if (!entity) return undefined

  // Convert back to full MessageBlock type
  return entity
}

// --- Centralized Citation Formatting Logic ---
export const formatCitationsFromBlock = (block: CitationMessageBlock | undefined): Citation[] => {
  if (!block) return []

  let formattedCitations: Citation[] = []
  // 1. Handle Web Search Responses
  if (block.response) {
    switch (block.response.source) {
      case WebSearchSource.GEMINI: {
        const groundingMetadata = block.response.results as GroundingMetadata
        formattedCitations =
          groundingMetadata?.groundingChunks?.map((chunk, index) => ({
            number: index + 1,
            url: chunk?.web?.uri || '',
            title: chunk?.web?.title,
            showFavicon: true,
            metadata: groundingMetadata.groundingSupports,
            type: 'websearch'
          })) || []
        break
      }
      case WebSearchSource.OPENAI_RESPONSE:
        formattedCitations =
          (block.response.results as OpenAI.Responses.ResponseOutputText.URLCitation[])?.map((result, index) => {
            let hostname: string | undefined
            try {
              hostname = result.title ? undefined : new URL(result.url).hostname
            } catch {
              hostname = result.url
            }
            return {
              number: index + 1,
              url: result.url,
              title: result.title,
              hostname: hostname,
              showFavicon: true,
              type: 'websearch'
            }
          }) || []
        break
      case WebSearchSource.OPENAI:
        formattedCitations =
          (block.response.results as OpenAI.Chat.Completions.ChatCompletionMessage.Annotation[])?.map((url, index) => {
            const urlCitation = url.url_citation
            let hostname: string | undefined
            try {
              hostname = urlCitation.title ? undefined : new URL(urlCitation.url).hostname
            } catch {
              hostname = urlCitation.url
            }
            return {
              number: index + 1,
              url: urlCitation.url,
              title: urlCitation.title,
              hostname: hostname,
              showFavicon: true,
              type: 'websearch'
            }
          }) || []
        break
      case WebSearchSource.ANTHROPIC:
        formattedCitations =
          (block.response.results as Array<WebSearchResultBlock>)?.map((result, index) => {
            const { url } = result
            let hostname: string | undefined
            try {
              hostname = new URL(url).hostname
            } catch {
              hostname = url
            }
            return {
              number: index + 1,
              url: url,
              title: result.title,
              hostname: hostname,
              showFavicon: true,
              type: 'websearch'
            }
          }) || []
        break
      case WebSearchSource.PERPLEXITY: {
        formattedCitations =
          (block.response.results as any[])?.map((result, index) => ({
            number: index + 1,
            url: result.url || result, // 兼容旧数据
            title: result.title || new URL(result).hostname, // 兼容旧数据
            showFavicon: true,
            type: 'websearch'
          })) || []
        break
      }
      case WebSearchSource.GROK:
      case WebSearchSource.OPENROUTER:
        formattedCitations =
          (block.response.results as AISDKWebSearchResult[])?.map((result, index) => {
            const url = result.url
            try {
              const hostname = new URL(result.url).hostname
              const content = result.providerMetadata && result.providerMetadata['openrouter']?.content
              return {
                number: index + 1,
                url,
                title: result.title || hostname,
                content: content as string,
                showFavicon: true,
                type: 'websearch'
              }
            } catch {
              return {
                number: index + 1,
                url,
                hostname: url,
                showFavicon: true,
                type: 'websearch'
              }
            }
          }) || []
        break
      case WebSearchSource.ZHIPU:
      case WebSearchSource.HUNYUAN:
        formattedCitations =
          (block.response.results as any[])?.map((result, index) => ({
            number: index + 1,
            url: result.link || result.url,
            title: result.title,
            showFavicon: true,
            type: 'websearch'
          })) || []
        break
      case WebSearchSource.WEBSEARCH:
        formattedCitations =
          (block.response.results as WebSearchProviderResponse)?.results?.map((result, index) => ({
            number: index + 1,
            url: result.url,
            title: result.title,
            content: result.content,
            showFavicon: true,
            type: 'websearch'
          })) || []
        break
      case WebSearchSource.AISDK:
        formattedCitations =
          (block.response?.results as AISDKWebSearchResult[])?.map((result, index) => ({
            number: index + 1,
            url: result.url,
            title: result.title || new URL(result.url).hostname,
            showFavicon: true,
            type: 'websearch',
            providerMetadata: result?.providerMetadata
          })) || []
        break
    }
  }
  // 3. Handle Knowledge Base References
  if (block.knowledge && Array.isArray(block.knowledge) && block.knowledge.length > 0) {
    formattedCitations.push(
      ...block.knowledge.map((result, index) => {
        const filePattern = /\[(.*?)]\(http:\/\/file\/(.*?)\)/
        const fileMatch = result.sourceUrl.match(filePattern)

        let url = result.sourceUrl
        let title = result.sourceUrl
        const showFavicon = true

        // 如果匹配文件链接格式 [filename](http://file/xxx)
        if (fileMatch) {
          title = fileMatch[1]
          url = `http://file/${fileMatch[2]}`
        }

        return {
          number: index + 1,
          url: url,
          title: title,
          content: result.content,
          showFavicon: showFavicon,
          type: 'knowledge'
        }
      })
    )
  }

  if (block.memories && Array.isArray(block.memories) && block.memories.length > 0) {
    // 5. Handle Memory References
    formattedCitations.push(
      ...block.memories.map((memory, index) => ({
        number: index + 1,
        url: '',
        title: `Memory ${memory.hash?.slice(0, 8)}`,
        content: memory.memory,
        showFavicon: false,
        type: 'memory'
      }))
    )
  }

  // 4. Deduplicate non-knowledge citations by URL and Renumber Sequentially
  const urlSet = new Set<string>()
  return formattedCitations
    .filter((citation) => {
      if (citation.type === 'knowledge' || citation.type === 'memory') return true
      if (!citation.url || urlSet.has(citation.url)) return false
      urlSet.add(citation.url)
      return true
    })
    .map((citation, index) => ({
      ...citation,
      number: index + 1
    }))
}
// --- End of Centralized Logic ---

// Memoized selector that takes a block ID and returns formatted citations
export const selectFormattedCitationsByBlockId = createSelector([selectBlockEntityById], (blockEntity): Citation[] => {
  if (blockEntity?.type === MESSAGE_BLOCK_TYPE.CITATION) {
    return formatCitationsFromBlock(blockEntity as CitationMessageBlock)
  }
  return []
})

// --- Active TodoWrite Block Selector ---
interface TodoWriteNormalToolResponse extends Omit<NormalToolResponse, 'tool' | 'arguments'> {
  tool: BaseTool & { name: 'TodoWrite' }
  arguments: TodoWriteToolInput
}

interface TodoWriteToolMessageBlock extends Omit<ToolMessageBlock, 'metadata'> {
  metadata: NonNullable<ToolMessageBlock['metadata']> & {
    rawMcpToolResponse: TodoWriteNormalToolResponse
  }
}

/**
 * Check if todos have any incomplete items
 */
const hasIncompleteTodos = (todos: TodoItem[]): boolean =>
  todos.some((todo) => todo.status === 'pending' || todo.status === 'in_progress')

/**
 * Check if a block is a TodoWrite tool block
 */
const isTodoWriteBlock = (block: MessageBlock | undefined): block is TodoWriteToolMessageBlock => {
  if (!block || block.type !== MESSAGE_BLOCK_TYPE.TOOL) return false
  const toolResponse = (block as ToolMessageBlock).metadata?.rawMcpToolResponse
  if (toolResponse?.tool?.name !== 'TodoWrite') return false
  // Defensive: validate todos is actually an array to prevent dirty data from crashing selectors (#12804)
  const args = toolResponse.arguments
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false
  return Array.isArray((args as Record<string, unknown>).todos)
}

/**
 * Information about active todos for PinnedTodoPanel
 */
export interface ActiveTodoInfo {
  /** All todos from the latest block with incomplete items */
  todos: TodoItem[]
  /** Current active todo (in_progress or first pending) */
  activeTodo: TodoItem | undefined
  /** Number of completed todos */
  completedCount: number
  /** Total number of todos */
  totalCount: number
  /** All TodoWrite blocks grouped by messageId (for batch deletion) */
  blockIdsByMessage: Record<string, string[]>
}

/**
 * Select active todo info for a topic in a single pass.
 * Returns undefined if no TodoWrite block with incomplete todos exists.
 *
 * Used by PinnedTodoPanel to display current task progress above the inputbar.
 */
export const selectActiveTodoInfo = createSelector(
  [
    (state: RootState) => state.messages.entities,
    (state: RootState) => state.messageBlocks.entities,
    (state: RootState) => state.messages.messageIdsByTopic,
    (_state: RootState, topicId: string) => topicId
  ],
  (messageEntities, blockEntities, messageIdsByTopic, topicId): ActiveTodoInfo | undefined => {
    const topicMessageIds = messageIdsByTopic[topicId]
    if (!topicMessageIds?.length) return undefined

    const blockIdsByMessage: Record<string, string[]> = {}
    let latestBlock: TodoWriteToolMessageBlock | undefined

    for (const messageId of topicMessageIds) {
      const message = messageEntities[messageId]
      if (!message?.blocks?.length) continue

      for (const blockId of message.blocks) {
        const block = blockEntities[blockId]
        if (isTodoWriteBlock(block)) {
          const ids = (blockIdsByMessage[messageId] ??= [])
          ids.push(blockId)
          const todos = block.metadata.rawMcpToolResponse?.arguments?.todos
          if (todos && hasIncompleteTodos(todos)) {
            latestBlock = block
          }
        }
      }
    }
    if (!latestBlock) return undefined
    const todos = latestBlock.metadata.rawMcpToolResponse?.arguments?.todos
    if (!todos) return undefined
    const activeTodo =
      todos.find((todo) => todo.status === 'in_progress') ?? todos.find((todo) => todo.status === 'pending')
    return {
      todos,
      activeTodo,
      completedCount: todos.filter((todo) => todo.status === 'completed').length,
      totalCount: todos.length,
      blockIdsByMessage
    }
  }
)

// --- Selector Integration --- END

export default messageBlocksSlice.reducer
