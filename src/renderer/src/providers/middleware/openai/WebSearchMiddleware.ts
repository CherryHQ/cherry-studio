import { isHunyuanSearchModel, isZhipuModel } from '@renderer/config/models'
import { WebSearchSource } from '@renderer/types'
import { Chunk, ChunkType, LLMWebSearchCompleteChunk } from '@renderer/types/chunk'
import { isEmpty } from 'lodash'
import OpenAI from 'openai'

import type { CompletionsOpenAIResult, CompletionsParams } from '../../AiProvider'
import { AiProviderMiddlewareCompletionsContext, CompletionsMiddleware } from '../middlewareTypes'

const MIDDLEWARE_NAME = 'WebSearchMiddleware'

/**
 * 处理Web搜索结果的辅助函数
 */
function handleWebSearchResults(
  sdkChunk: OpenAI.Chat.Completions.ChatCompletionChunk,
  delta: any,
  model: any,
  assistant: any,
  controller: TransformStreamDefaultController<Chunk>
) {
  const finishReason = sdkChunk.choices?.[0]?.finish_reason

  // OpenAI annotations（需要在finish时处理）
  if (delta?.annotations) {
    if (assistant.model?.provider === 'copilot') return

    const webSearchChunk: LLMWebSearchCompleteChunk = {
      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
      llm_web_search: {
        results: delta.annotations,
        source: WebSearchSource.OPENAI_RESPONSE
      }
    }
    controller.enqueue(webSearchChunk)
  }

  // Grok citations
  if (assistant.model?.provider === 'grok') {
    const citations = (sdkChunk as any).citations
    if (citations) {
      const webSearchChunk: LLMWebSearchCompleteChunk = {
        type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
        llm_web_search: {
          results: citations,
          source: WebSearchSource.GROK
        }
      }
      controller.enqueue(webSearchChunk)
    }
  }

  // Perplexity citations
  if (assistant.model?.provider === 'perplexity') {
    const citations = (sdkChunk as any).citations
    if (citations) {
      const webSearchChunk: LLMWebSearchCompleteChunk = {
        type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
        llm_web_search: {
          results: citations,
          source: WebSearchSource.PERPLEXITY
        }
      }
      controller.enqueue(webSearchChunk)
    }
  }

  // Zhipu web search - 需要检查enableWebSearch和finishReason
  if (assistant.enableWebSearch && isZhipuModel(model) && finishReason === 'stop' && (sdkChunk as any)?.web_search) {
    const webSearchChunk: LLMWebSearchCompleteChunk = {
      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
      llm_web_search: {
        results: (sdkChunk as any).web_search,
        source: WebSearchSource.ZHIPU
      }
    }
    controller.enqueue(webSearchChunk)
  }

  // Hunyuan web search
  if (assistant.enableWebSearch && isHunyuanSearchModel(model) && (sdkChunk as any)?.search_info?.search_results) {
    const webSearchChunk: LLMWebSearchCompleteChunk = {
      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
      llm_web_search: {
        results: (sdkChunk as any).search_info.search_results,
        source: WebSearchSource.HUNYUAN
      }
    }
    controller.enqueue(webSearchChunk)
  }

  // OpenRouter citations - 检查provider是否为openrouter
  if (assistant.model?.provider === 'openrouter') {
    const citations = (sdkChunk as any).citations
    if (citations) {
      const webSearchChunk: LLMWebSearchCompleteChunk = {
        type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
        llm_web_search: {
          results: citations,
          source: WebSearchSource.OPENROUTER
        }
      }
      controller.enqueue(webSearchChunk)
    }
  }

  // OpenAI web search - 检查provider是否为openai且有web_search字段
  if (assistant.enableWebSearch && assistant.model?.provider === 'openai' && (sdkChunk as any)?.web_search) {
    const webSearchChunk: LLMWebSearchCompleteChunk = {
      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
      llm_web_search: {
        results: (sdkChunk as any).web_search,
        source: WebSearchSource.OPENAI
      }
    }
    controller.enqueue(webSearchChunk)
  }

  // Anthropic web search - 检查provider是否为anthropic
  if (assistant.enableWebSearch && assistant.model?.provider === 'anthropic' && (sdkChunk as any)?.web_search) {
    const webSearchChunk: LLMWebSearchCompleteChunk = {
      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
      llm_web_search: {
        results: (sdkChunk as any).web_search,
        source: WebSearchSource.ANTHROPIC
      }
    }
    controller.enqueue(webSearchChunk)
  }

  // Gemini groundingMetadata - 通常在delta或者chunk中
  if (
    assistant.enableWebSearch &&
    assistant.model?.provider === 'gemini' &&
    (delta?.groundingMetadata || (sdkChunk as any)?.groundingMetadata)
  ) {
    const groundingMetadata = delta?.groundingMetadata || (sdkChunk as any)?.groundingMetadata
    const webSearchChunk: LLMWebSearchCompleteChunk = {
      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
      llm_web_search: {
        results: groundingMetadata,
        source: WebSearchSource.GEMINI
      }
    }
    controller.enqueue(webSearchChunk)
  }

  // Qwen web search
  if (assistant.enableWebSearch && assistant.model?.provider === 'qwenlm' && (sdkChunk as any)?.web_search) {
    const webSearchChunk: LLMWebSearchCompleteChunk = {
      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
      llm_web_search: {
        results: (sdkChunk as any).web_search,
        source: WebSearchSource.QWEN
      }
    }
    controller.enqueue(webSearchChunk)
  }
}

/**
 * Web搜索处理中间件
 * 职责：
 * 1. 检测和处理各种Web搜索结果（annotations, citations, web_search等）
 * 2. 生成 LLM_WEB_SEARCH_COMPLETE chunks
 *
 * 注意：链接转换逻辑已移至TextChunkMiddleware中处理
 */

export const WebSearchMiddleware: CompletionsMiddleware =
  () => (next) => async (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => {
    const resultFromUpstream = await next(context, params)

    console.log(
      `[${MIDDLEWARE_NAME}] Received result from upstream. Stream is: ${resultFromUpstream.stream ? 'present' : 'absent'}`
    )

    // 检查是否有流需要处理
    if (resultFromUpstream.stream && resultFromUpstream.stream instanceof ReadableStream) {
      const inputStream = resultFromUpstream.stream as ReadableStream<
        Chunk | OpenAI.Chat.Completions.ChatCompletionChunk
      >

      const assistant = context.assistant!
      const model = context.model!

      console.log(
        `[${MIDDLEWARE_NAME}] Processing web search results for model: ${model?.id}, provider: ${model?.provider}`
      )

      const processedStream = inputStream.pipeThrough(
        new TransformStream<Chunk | OpenAI.Chat.Completions.ChatCompletionChunk, Chunk>({
          transform(item, controller) {
            // 处理 SDK chunk - 检查是否有搜索结果需要处理
            const sdkChunk = item as OpenAI.Chat.Completions.ChatCompletionChunk
            const choice = sdkChunk.choices?.[0]

            if (!choice) {
              controller.enqueue(sdkChunk as any)
              return
            }

            const delta = choice.delta

            // 检查finish状态，处理Web搜索结果
            const finishReason = choice.finish_reason
            if (!isEmpty(finishReason)) {
              handleWebSearchResults(sdkChunk, delta, model, assistant, controller)
            }

            // 传递原始chunk到下游中间件
            controller.enqueue(sdkChunk as any)
          }
        })
      )

      const adaptedResult: CompletionsOpenAIResult = {
        ...resultFromUpstream,
        stream: processedStream
      }

      console.log(`[${MIDDLEWARE_NAME}] Set up web search result processing for model: ${model?.id}`)
      return adaptedResult
    } else {
      console.log(`[${MIDDLEWARE_NAME}] No stream to process or not a ReadableStream. Returning original result.`)
      return resultFromUpstream
    }
  }
