import { type Chunk, ChunkType, type ErrorChunk } from '@renderer/types/chunk'

import type { CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'AbortHandlerMiddleware'

export const AbortHandlerMiddleware: CompletionsMiddleware = async (ctx, next) => {
  const params = ctx.originalParams
  const internalData = (params as any)._internal
  const isRecursiveCall = internalData?.isRecursiveCall || false
  const recursionDepth = internalData?.recursionDepth || 0

  console.log(`🔄 [${MIDDLEWARE_NAME}] Starting middleware. isRecursive: ${isRecursiveCall}, depth: ${recursionDepth}`)

  // 在递归调用中，跳过 AbortController 的创建，直接使用已有的
  if (isRecursiveCall) {
    console.log(`🔄 [${MIDDLEWARE_NAME}] Recursive call detected, skipping AbortController creation`)
    await next()
    return
  }

  console.log(`🔄 [${MIDDLEWARE_NAME}] Creating AbortController for request`)

  // 从context获取apiClient实例
  const apiClient = ctx.apiClientInstance
  if (!apiClient) {
    throw new Error('ApiClient instance not found in context')
  }

  // 获取当前消息的ID用于abort管理
  // 优先使用处理过的消息，如果没有则使用原始消息
  const processedMessages = internalData?.processedMessages || params.messages
  const lastUserMessage = processedMessages.findLast((m: any) => m.role === 'user')
  const messageId = lastUserMessage?.id

  // 使用BaseApiClient的createAbortController方法创建AbortController
  const apiClientWithAbort = apiClient
  if (!apiClientWithAbort.createAbortController) {
    console.warn(`🔄 [${MIDDLEWARE_NAME}] ApiClient does not have createAbortController method`)
    await next()
    return
  }

  const { abortController, cleanup } = apiClientWithAbort.createAbortController(messageId, false)
  const abortSignal = abortController.signal

  console.log(`🔄 [${MIDDLEWARE_NAME}] AbortController created for message: ${messageId}`)

  // 将controller添加到_internal中的flowControl状态
  if (!ctx._internal.flowControl) {
    ctx._internal.flowControl = {}
  }
  ctx._internal.flowControl.abortController = abortController
  ctx._internal.flowControl.abortSignal = abortSignal
  ctx._internal.flowControl.cleanup = cleanup

  console.log('ctx._internal.flowControl', ctx._internal.flowControl)

  try {
    // 调用下游中间件
    await next()

    // 响应后处理：为流式响应添加abort处理
    if (
      ctx._internal.apiCall?.genericChunkStream &&
      ctx._internal.apiCall.genericChunkStream instanceof ReadableStream
    ) {
      const originalStream = ctx._internal.apiCall.genericChunkStream

      // 检查abort状态
      if (abortSignal.aborted) {
        console.log(`🔄 [${MIDDLEWARE_NAME}] Request already aborted, cleaning up`)
        cleanup()
        throw new DOMException('Request was aborted', 'AbortError')
      }

      const error = new DOMException('Request was aborted', 'AbortError')

      // 使用 TransformStream 处理 abort 检测
      const streamWithAbortHandler = originalStream.pipeThrough(
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

      // 更新流
      ctx._internal.apiCall.genericChunkStream = streamWithAbortHandler

      console.log(
        `🔄 [${MIDDLEWARE_NAME}] Set up abort handling with TransformStream, cleanup will be called when stream ends`
      )
    } else {
      // 对于非流式响应，直接清理
      console.log(`🔄 [${MIDDLEWARE_NAME}] No stream to process, cleaning up immediately`)
      cleanup()
    }
  } catch (error) {
    console.error(`🔄 [${MIDDLEWARE_NAME}] Error occurred, cleaning up:`, error)
    cleanup()
    throw error
  }
}
