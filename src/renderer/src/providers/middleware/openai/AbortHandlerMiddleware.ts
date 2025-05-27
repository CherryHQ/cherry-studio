import { type Chunk, ChunkType, type ErrorChunk } from '@renderer/types/chunk'

import type { CompletionsOpenAIResult } from '../../AiProvider'
import type { CompletionsMiddleware } from '../middlewareTypes'

const MIDDLEWARE_NAME = 'AbortHandlerMiddleware'

export const AbortHandlerMiddleware: CompletionsMiddleware = () => (next) => async (context, params) => {
  const isRecursiveCall = context._internal?.isRecursiveCall || false
  const recursionDepth = context._internal?.recursionDepth || 0

  console.log(`🔄 [${MIDDLEWARE_NAME}] Starting middleware. isRecursive: ${isRecursiveCall}, depth: ${recursionDepth}`)

  // 在递归调用中，跳过 AbortController 的创建，直接使用已有的
  if (isRecursiveCall) {
    console.log(`🔄 [${MIDDLEWARE_NAME}] Recursive call detected, skipping AbortController creation`)
    return next(context, params)
  }

  console.log(`🔄 [${MIDDLEWARE_NAME}] Creating AbortController for request`)

  // 从context获取provider实例
  const provider = context._providerInstance
  if (!provider) {
    throw new Error('Provider instance not found in context')
  }

  // 获取当前消息的ID用于abort管理
  // 优先使用处理过的消息，如果没有则使用原始消息
  const processedMessages = params._internal?.processedMessages || params.messages
  const lastUserMessage = processedMessages.findLast((m) => m.role === 'user')
  const messageId = lastUserMessage?.id

  // 使用BaseProvider的createAbortController方法创建AbortController
  const { abortController, cleanup } = provider.createAbortController(messageId, false)
  const abortSignal = abortController.signal

  console.log(`🔄 [${MIDDLEWARE_NAME}] AbortController created for message: ${messageId}`)

  // 将controller添加到params._internal中
  if (params._internal) params._internal.controller = abortController
  console.log('params._internal', params)

  try {
    const resultFromUpstream = await next(context, params)

    if (resultFromUpstream.stream && resultFromUpstream.stream instanceof ReadableStream) {
      const originalStream = resultFromUpstream.stream

      // 检查abort状态
      if (abortSignal.aborted) {
        console.log(`🔄 [${MIDDLEWARE_NAME}] Request already aborted, cleaning up`)
        cleanup()
        throw new DOMException('Request was aborted', 'AbortError')
      }

      const error = new DOMException('Request was aborted', 'AbortError')

      // 使用 TransformStream 处理 abort 检测
      const streamWithAbortHandler = (originalStream as ReadableStream<Chunk>).pipeThrough(
        new TransformStream<Chunk, Chunk | ErrorChunk>({
          transform(chunk, controller) {
            // 检查 abort 状态
            if (abortSignal.aborted) {
              console.log(`🔄 [${MIDDLEWARE_NAME}] Abort detected, converting to ErrorChunk`)

              // 转换为 ErrorChunk
              const errorChunk: ErrorChunk = {
                type: ChunkType.ERROR,
                error
              }

              controller.enqueue(errorChunk)
              return
            }

            // 正常传递 chunk
            controller.enqueue(chunk)
          },

          flush(controller) {
            // 在流结束时再次检查 abort 状态
            if (abortSignal.aborted) {
              console.log(`🔄 [${MIDDLEWARE_NAME}] Abort detected at flush, converting to ErrorChunk`)
              // TODO: 也可以手动throw error，更贴合现有的onError处理方式，但是会破坏流转换的统一逻辑，还没想好怎么处理比较好
              const errorChunk: ErrorChunk = {
                type: ChunkType.ERROR,
                error
              }
              controller.enqueue(errorChunk)
            }
            // 在流完全处理完成后清理 AbortController
            console.log(`🔄 [${MIDDLEWARE_NAME}] Stream processing completed, cleaning up AbortController`)
            cleanup()
          }
        })
      )

      const adaptedResult: CompletionsOpenAIResult = {
        ...resultFromUpstream,
        stream: streamWithAbortHandler
      }

      console.log(
        `🔄 [${MIDDLEWARE_NAME}] Set up abort handling with TransformStream, cleanup will be called when stream ends`
      )
      return adaptedResult
    }

    // 对于非流式响应，直接清理并返回原始结果
    console.log(`🔄 [${MIDDLEWARE_NAME}] No stream to process, cleaning up immediately`)
    cleanup()
    return resultFromUpstream
  } catch (error) {
    console.error(`🔄 [${MIDDLEWARE_NAME}] Error occurred, cleaning up:`, error)
    cleanup()
    throw error
  }
}
