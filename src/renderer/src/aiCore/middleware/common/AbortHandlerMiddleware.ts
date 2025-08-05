import { loggerService } from '@logger'
import { Chunk, ChunkType, ErrorChunk } from '@renderer/types/chunk'
import { addAbortController, removeAbortController } from '@renderer/utils/abortController'

import { CompletionsParams, CompletionsResult } from '../schemas'
import type { CompletionsContext, CompletionsMiddleware } from '../types'

const logger = loggerService.withContext('aiCore:AbortHandlerMiddleware')

export const MIDDLEWARE_NAME = 'AbortHandlerMiddleware'

export const AbortHandlerMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const isRecursiveCall = ctx._internal?.toolProcessingState?.isRecursiveCall || false

    // 在递归调用中，跳过 AbortController 的创建，直接使用已有的
    if (isRecursiveCall) {
      const result = await next(ctx, params)
      return result
    }

    // 获取当前消息的ID用于abort管理
    // 优先使用处理过的消息，如果没有则使用原始消息
    let messageId: string | undefined

    if (typeof params.messages === 'string') {
      messageId = `message-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    } else {
      const processedMessages = params.messages
      const lastUserMessage = processedMessages.findLast((m) => m.role === 'user')
      messageId = lastUserMessage?.id
    }

    if (!messageId) {
      logger.warn(`No messageId found, abort functionality will not be available.`)
      return next(ctx, params)
    }

    const abortController = new AbortController()
    const abortFn = (): void => abortController.abort()

    addAbortController(messageId, abortFn)

    let abortSignal: AbortSignal | null = abortController.signal

    const cleanup = (): void => {
      removeAbortController(messageId as string, abortFn)
      if (ctx._internal?.flowControl) {
        ctx._internal.flowControl.abortController = undefined
        ctx._internal.flowControl.abortSignal = undefined
        ctx._internal.flowControl.cleanup = undefined
      }
      abortSignal = null
    }

    // 将controller添加到_internal中的flowControl状态
    if (!ctx._internal.flowControl) {
      ctx._internal.flowControl = {}
    }
    ctx._internal.flowControl.abortController = abortController
    ctx._internal.flowControl.abortSignal = abortSignal
    ctx._internal.flowControl.cleanup = cleanup

    const result = await next(ctx, params)

    const error = new DOMException('Request was aborted', 'AbortError')

    const streamWithAbortHandler = (result.stream as ReadableStream<Chunk>).pipeThrough(
      new TransformStream<Chunk, Chunk | ErrorChunk>({
        transform(chunk, controller) {
          // 如果已经收到错误块，不再检查 abort 状态
          if (chunk.type === ChunkType.ERROR) {
            controller.enqueue(chunk)
            return
          }

          if (abortSignal?.aborted) {
            // 转换为 ErrorChunk
            const errorChunk: ErrorChunk = {
              type: ChunkType.ERROR,
              error
            }

            controller.enqueue(errorChunk)
            cleanup()
            return
          }

          // 正常传递 chunk
          controller.enqueue(chunk)
        },

        flush(controller) {
          // 在流结束时再次检查 abort 状态
          if (abortSignal?.aborted) {
            const errorChunk: ErrorChunk = {
              type: ChunkType.ERROR,
              error
            }
            controller.enqueue(errorChunk)
          }
          // 在流完全处理完成后清理 AbortController
          cleanup()
        }
      })
    )

    return {
      ...result,
      stream: streamWithAbortHandler
    }
  }
