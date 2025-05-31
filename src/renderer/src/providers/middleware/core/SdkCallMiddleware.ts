import { ChunkType } from '@renderer/types/chunk'

import { CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'SdkCallMiddleware'

/**
 * SDK调用中间件
 *
 * 职责：
 * 1. 使用ApiClient的SDK实例执行实际的API调用
 * 2. 使用之前中间件转换好的SDK参数
 * 3. 将原始SDK响应保存到context中供后续中间件处理
 */
export const SdkCallMiddleware: CompletionsMiddleware = async (ctx, next) => {
  console.log(`🚀 [${MIDDLEWARE_NAME}] Starting SDK call`)

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
    // 获取SDK实例
    const sdk = await apiClient.getSdkInstance()

    console.log(`🚀 [${MIDDLEWARE_NAME}] Making SDK call with transformed parameters`)
    console.log(`🚀 [${MIDDLEWARE_NAME}] SDK payload type:`, typeof sdkPayload)

    ctx.originalParams.onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
    // 执行实际的SDK调用
    // @ts-ignore - SDK参数可能有额外的字段
    const rawSdkOutput = await sdk.chat.completions.create(sdkPayload)

    console.log(`🚀 [${MIDDLEWARE_NAME}] SDK call completed successfully`)
    console.log(`🚀 [${MIDDLEWARE_NAME}] Response type:`, typeof rawSdkOutput)

    // 将原始SDK响应保存到context中
    if (!ctx._internal.apiCall) {
      ctx._internal.apiCall = {}
    }
    ctx._internal.apiCall.rawSdkOutput = rawSdkOutput
    ctx._internal.apiCall.requestTimestamp = Date.now()

    // 调用下游中间件来处理响应
    await next()
  } catch (error) {
    console.error(`🚀 [${MIDDLEWARE_NAME}] SDK call failed:`, error)
    throw error
  }
}
