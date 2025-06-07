import Logger from '@renderer/config/logger'

import { CompletionsParams, CompletionsResult } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'TransformCoreToSdkParamsMiddleware'

/**
 * 中间件：将CoreCompletionsRequest转换为SDK特定的参数
 * 使用上下文中ApiClient实例的requestTransformer进行转换
 */
export const TransformCoreToSdkParamsMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    Logger.debug(`🔄 [${MIDDLEWARE_NAME}] Starting core to SDK params transformation:`, ctx)

    const internal = ctx._internal

    // 🔧 检测递归调用：检查 params 中是否携带了预处理的 SDK 消息
    const isRecursiveCall = internal?.toolProcessingState?.isRecursiveCall || false
    const newSdkMessages = params._internal?.newReqMessages

    const apiClient = ctx.apiClientInstance

    if (!apiClient) {
      Logger.error(`🔄 [${MIDDLEWARE_NAME}] ApiClient instance not found in context.`)
      throw new Error('ApiClient instance not found in context')
    }

    // 检查是否有requestTransformer方法
    const requestTransformer = apiClient.getRequestTransformer()
    if (!requestTransformer) {
      Logger.warn(
        `🔄 [${MIDDLEWARE_NAME}] ApiClient does not have getRequestTransformer method, skipping transformation`
      )
      const result = await next(ctx, params)
      return result
    }

    // 确保assistant和model可用，它们是transformer所需的
    const assistant = params.assistant
    const model = assistant?.model

    if (!assistant || !model) {
      console.error(`🔄 [${MIDDLEWARE_NAME}] Assistant or Model not found for transformation.`)
      throw new Error('Assistant or Model not found for transformation')
    }

    try {
      // 调用transformer进行转换
      Logger.debug(
        `🔄 [${MIDDLEWARE_NAME}] Transforming ${params.messages?.length || 0} application messages to SDK format`
      )
      const transformResult = await requestTransformer.transform(
        params,
        assistant,
        model,
        isRecursiveCall,
        newSdkMessages
      )

      const { payload: sdkPayload, metadata, processedMessages } = transformResult

      // 将SDK特定的payload和metadata存储在状态中，供下游中间件使用
      ctx._internal.sdkPayload = sdkPayload
      ctx._internal.processedMessages = processedMessages
      if (metadata) {
        ctx._internal.customState = {
          ...ctx._internal.customState,
          sdkMetadata: metadata
        }
      }

      Logger.debug(`🔄 [${MIDDLEWARE_NAME}] Successfully transformed CoreCompletionsRequest to SDK params:`, sdkPayload)
      Logger.debug(`🔄 [${MIDDLEWARE_NAME}] Has metadata:`, !!metadata)

      return next(ctx, params)
    } catch (error) {
      Logger.error(`🔄 [${MIDDLEWARE_NAME}] Error during request transformation:`, error)
      // 让错误向上传播，或者可以在这里进行特定的错误处理
      throw error
    }
  }
