import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'

import type { CompletionsOpenAIResult } from '../../AiProvider'
import type { CompletionsMiddleware } from '../middlewareTypes'

const MIDDLEWARE_NAME = 'FinalChunkConsumerAndNotifierMiddleware'

export const FinalChunkConsumerAndNotifierMiddleware: CompletionsMiddleware =
  () => (next) => async (context, params) => {
    // This middleware is intended to be at the end of a chain of "transforming" middlewares.
    // It calls `next` to get the final processed stream from them.

    const isRecursiveCall = context._internal?.isRecursiveCall || false
    const recursionDepth = context._internal?.recursionDepth || 0

    console.log(`[${MIDDLEWARE_NAME}] Starting middleware. isRecursive: ${isRecursiveCall}, depth: ${recursionDepth}`)

    const resultFromUpstream = await next(context, params)

    console.log(
      `[${MIDDLEWARE_NAME}] Received result from upstream. Stream available: ${!!resultFromUpstream.stream}, isRecursive: ${isRecursiveCall}, depth: ${recursionDepth}`
    )

    if (resultFromUpstream.stream && resultFromUpstream.stream instanceof ReadableStream) {
      // Explicitly cast the inputStream to ReadableStream<Chunk> after the instanceof check
      // This assumes upstream middlewares correctly provide a ReadableStream<Chunk>
      const inputStream = resultFromUpstream.stream as ReadableStream<Chunk>
      const reader = inputStream.getReader()
      // let accumulatedText = '' // Commented out as it's unused for now

      console.log(`[${MIDDLEWARE_NAME}] Starting to consume and notify chunks. IsRecursive: ${isRecursiveCall}`)
      try {
        while (true) {
          const { done, value: chunk } = await reader.read()

          if (done) {
            console.log(`[${MIDDLEWARE_NAME}] Input stream finished.`)
            break
          }
          // Ensure chunk is not undefined before accessing its properties
          if (chunk) {
            const chunkType: ChunkType = chunk.type
            // let chunkDetails = ''
            // if ('text' in chunk && typeof chunk.text === 'string') {
            //   chunkDetails = `: ${chunk.text.substring(0, 50)}...`
            // } else if (chunk.type === 'llm_response_complete' && chunk.response?.usage) {
            //   chunkDetails = `: Usage ${JSON.stringify(chunk.response.usage)}`
            // }

            // 过滤递归调用中的完成状态
            const shouldSkipChunk =
              isRecursiveCall &&
              (chunk.type === ChunkType.BLOCK_COMPLETE || chunk.type === ChunkType.LLM_RESPONSE_COMPLETE)

            if (shouldSkipChunk) {
              console.log(`[${MIDDLEWARE_NAME}] Skipping completion chunk in recursive call - Type: ${chunkType}`)
            } else {
              // console.log(`[${MIDDLEWARE_NAME}] Dispatching chunk via onChunk - Type: ${chunkType}${chunkDetails}`)
              if (params.onChunk) {
                params.onChunk(chunk)
              }
            }
          } else {
            // Should not happen if done is false, but good to be defensive
            console.warn(`[${MIDDLEWARE_NAME}] Received undefined chunk before stream was done.`)
          }

          // if (chunk && chunk.type === ChunkType.TEXT_DELTA && typeof chunk.text === 'string') { // Corrected ChunkType access
          //   accumulatedText += chunk.text;
          // }
        }
      } catch (error) {
        console.error(`[${MIDDLEWARE_NAME}] Error consuming stream:`, error)
        throw error
      } finally {
        // console.log(`[${MIDDLEWARE_NAME}] Finished consuming stream.`)

        // 重新检查递归状态，因为它可能在递归调用期间被修改
        const finalIsRecursiveCall = context._internal?.isRecursiveCall || false
        const finalRecursionDepth = context._internal?.recursionDepth || 0

        console.log(`[${MIDDLEWARE_NAME}] Final state check:`)
        console.log(`  - Initial: isRecursive=${isRecursiveCall}, depth=${recursionDepth}`)
        console.log(`  - Final: isRecursive=${finalIsRecursiveCall}, depth=${finalRecursionDepth}`)

        // 只在非递归调用时发送最终完成状态
        if (!finalIsRecursiveCall && params.onChunk) {
          console.log(`[${MIDDLEWARE_NAME}] Sending final completion chunks (top-level call)`)

          // 发送 BLOCK_COMPLETE
          params.onChunk({
            type: ChunkType.BLOCK_COMPLETE,
            response: undefined
          })

          // 发送 LLM_RESPONSE_COMPLETE
          params.onChunk({
            type: ChunkType.LLM_RESPONSE_COMPLETE,
            response: undefined
          })

          // 重置递归标记（确保下次调用是干净的状态）
          if (context._internal) {
            context._internal.isRecursiveCall = false
            context._internal.recursionDepth = 0
          }
        } else {
          console.log(`[${MIDDLEWARE_NAME}] Skipping final completion chunks (recursive call detected)`)
        }
      }

      const finalResult: CompletionsOpenAIResult = {
        ...resultFromUpstream,
        // Create an empty, already-closed stream explicitly typed as ReadableStream<Chunk>
        stream: new ReadableStream<Chunk>({
          // Explicitly type the new ReadableStream
          start(controller) {
            controller.close()
          }
        })
        // text: accumulatedText,
      }
      return finalResult
    } else {
      console.log(
        `[${MIDDLEWARE_NAME}] No stream to process or stream is not ReadableStream. Returning original result from upstream.`
      )
      return resultFromUpstream
    }
  }
