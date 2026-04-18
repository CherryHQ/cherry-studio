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
import { createEntityAdapter, createSlice } from '@reduxjs/toolkit'
import type { AISDKWebSearchResult, Citation, WebSearchProviderResponse } from '@renderer/types'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { CitationMessageBlock, MessageBlock } from '@renderer/types/newMessage'

import type { RootState } from './index' // 确认 RootState 从 store/index.ts 导出

// Create a simplified type for the entity adapter to avoid circular type issues
type MessageBlockEntity = MessageBlock

// 1. 创建实体适配器 (Entity Adapter)
// 我们使用块的 `id` 作为唯一标识符。
const messageBlocksAdapter = createEntityAdapter<MessageBlockEntity>()

// 2. 使用适配器定义初始状态 (Initial State)
// 如果需要，可以在规范化实体的旁边添加其他状态属性。
const initialState = messageBlocksAdapter.getInitialState()

// 3. 创建 Slice
// @ts-ignore ignore
export const messageBlocksSlice = createSlice({
  name: 'messageBlocks',
  initialState,
  reducers: {
    /** 添加或更新单个块 (Upsert)。 */
    upsertOneBlock: messageBlocksAdapter.upsertOne,

    /** 添加或更新多个块。用于加载消息。 */
    upsertManyBlocks: messageBlocksAdapter.upsertMany,

    /** 根据 ID 列表移除多个块。用于清理话题。 */
    removeManyBlocks: messageBlocksAdapter.removeMany,

    /** 更新单个块（仅提供 changes）。 */
    updateOneBlock: messageBlocksAdapter.updateOne
  }
})

// 4. 导出 Actions 和 Reducer
export const { upsertOneBlock, upsertManyBlocks, removeManyBlocks, updateOneBlock } = messageBlocksSlice.actions

export const messageBlocksSelectors = messageBlocksAdapter.getSelectors<RootState>(
  (state) => state.messageBlocks // Ensure this matches the key in the root reducer
)

// --- Centralized Citation Formatting Logic ---
export const formatCitationsFromBlock = (block: CitationMessageBlock | undefined): Citation[] => {
  if (!block) return []

  let formattedCitations: Citation[] = []
  // 1. Handle Web Search Responses
  if (block.response) {
    switch (block.response.source) {
      case WEB_SEARCH_SOURCE.GEMINI: {
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
      case WEB_SEARCH_SOURCE.OPENAI_RESPONSE:
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
      case WEB_SEARCH_SOURCE.OPENAI:
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
      case WEB_SEARCH_SOURCE.ANTHROPIC:
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
      case WEB_SEARCH_SOURCE.PERPLEXITY: {
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
      case WEB_SEARCH_SOURCE.GROK:
        formattedCitations =
          (block.response.results as AISDKWebSearchResult[])?.map((result, index) => {
            const url = result.url
            try {
              const hostname = new URL(result.url).hostname
              // xAI source events use citation number as title, fall back to hostname
              const title = result.title && /^\d+$/.test(result.title) ? hostname : result.title || hostname
              return {
                number: index + 1,
                url,
                title,
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
      case WEB_SEARCH_SOURCE.OPENROUTER:
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
      case WEB_SEARCH_SOURCE.ZHIPU:
      case WEB_SEARCH_SOURCE.HUNYUAN:
        formattedCitations =
          (block.response.results as any[])?.map((result, index) => ({
            number: index + 1,
            url: result.link || result.url,
            title: result.title,
            showFavicon: true,
            type: 'websearch'
          })) || []
        break
      case WEB_SEARCH_SOURCE.WEBSEARCH:
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
      case WEB_SEARCH_SOURCE.AISDK:
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

// --- Selector Integration --- END

export default messageBlocksSlice.reducer
