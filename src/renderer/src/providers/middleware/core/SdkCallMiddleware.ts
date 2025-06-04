import Logger from '@renderer/config/logger'
import { ChunkType } from '@renderer/types/chunk'

import { CompletionsParams, CompletionsResult } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

const MIDDLEWARE_NAME = 'SdkCallMiddleware'

/**
 * SDK调用中间件
 *
 * 职责：
 * 1. 使用ApiClient的SDK实例执行实际的API调用
 * 2. 使用之前中间件转换好的SDK参数
 * 3. 将原始SDK响应保存到context中供后续中间件处理
 */
export const SdkCallMiddleware: CompletionsMiddleware =
  () =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (_next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    Logger.debug(`🚀 [${MIDDLEWARE_NAME}] Starting SDK call`)

    const apiClient = ctx.apiClientInstance
    if (!apiClient) {
      console.error(`🚀 [${MIDDLEWARE_NAME}] ApiClient instance not found in context`)
      throw new Error('ApiClient instance not found in context')
    }

    // 检查是否有转换后的SDK参数
    const sdkPayload = ctx._internal.sdkPayload
    if (!sdkPayload) {
      console.error(
        `🚀 [${MIDDLEWARE_NAME}] SDK payload not found in context. TransformCoreToSdkParamsMiddleware should run before this.`
      )
      throw new Error('SDK payload not found in context')
    }

    try {
      Logger.debug(`🚀 [${MIDDLEWARE_NAME}] Making SDK call with transformed parameters`)
      Logger.debug(`🚀 [${MIDDLEWARE_NAME}] SDK payload type:`, typeof sdkPayload)

      params.onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
      // 执行实际的SDK调用
      // @ts-ignore - SDK参数可能有额外的字段
      const rawSdkOutput = await apiClient.createCompletions(sdkPayload)

      Logger.debug(`🚀 [${MIDDLEWARE_NAME}] SDK call completed successfully`)
      Logger.debug(`🚀 [${MIDDLEWARE_NAME}] Response:`, rawSdkOutput)

      return {
        rawOutput: rawSdkOutput
      }
    } catch (error) {
      Logger.error(`🚀 [${MIDDLEWARE_NAME}] SDK call failed:`, error)
      throw error
    }
  }
