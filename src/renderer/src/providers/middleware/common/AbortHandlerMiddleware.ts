import { addAbortController, removeAbortController } from '@renderer/utils/abortController'

import { CompletionsParams, CompletionsResult } from '../schemas'
import type { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'AbortHandlerMiddleware'

export const AbortHandlerMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const isRecursiveCall = ctx._internal?.toolProcessingState?.isRecursiveCall || false
    // const recursionDepth = ctx._internal?.toolProcessingState?.recursionDepth || 0

    // console.log(`[${MIDDLEWARE_NAME}] Starting middleware execution`)
    // console.log(
    //   `🔄 [${MIDDLEWARE_NAME}] Starting middleware. isRecursive: ${isRecursiveCall}, depth: ${recursionDepth}`
    // )

    // 在递归调用中，跳过 AbortController 的创建，直接使用已有的
    if (isRecursiveCall) {
      // console.log(`🔄 [${MIDDLEWARE_NAME}] Recursive call detected, skipping AbortController creation`)
      // console.log(`[${MIDDLEWARE_NAME}] Calling downstream middleware (recursive)`)
      const result = await next(ctx, params)
      // console.log(`[${MIDDLEWARE_NAME}] Downstream middleware completed (recursive)`)
      return result
    }

    // console.log(`🔄 [${MIDDLEWARE_NAME}] Creating AbortController for request`)

    // 获取当前消息的ID用于abort管理
    // 优先使用处理过的消息，如果没有则使用原始消息
    let messageId: string | undefined

    if (typeof params.messages === 'string') {
      messageId = `message-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    } else {
      const processedMessages = params.messages
      const lastUserMessage = processedMessages.findLast((m) => m.role === 'user')
      messageId = lastUserMessage?.id
      console.log(`🔄 [${MIDDLEWARE_NAME}] Using messageId from last user message: ${messageId}`)
    }

    if (!messageId) {
      console.warn(`[${MIDDLEWARE_NAME}] No messageId found, abort functionality will not be available.`)
      return next(ctx, params)
    }

    const abortController = new AbortController()
    const abortFn = (): void => abortController.abort()

    addAbortController(messageId, abortFn)

    const cleanup = (): void => {
      removeAbortController(messageId as string, abortFn)
    }

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

    // This middleware is now only responsible for creating the abort controller and setting up the context.
    // The actual handling of the abort signal (e.g., throwing an error) and calling cleanup()
    // is delegated to downstream middlewares or the final consumer of the stream.
    return next(ctx, params)
  }
