import { CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'TransformCoreToSdkParamsMiddleware'

/**
 * 中间件：将CoreCompletionsRequest转换为SDK特定的参数 - Koa洋葱圈风格
 * 使用上下文中ApiClient实例的requestTransformer进行转换
 */
export const TransformCoreToSdkParamsMiddleware: CompletionsMiddleware = async (ctx, next) => {
  console.log(`🔄 [${MIDDLEWARE_NAME}] Starting core to SDK params transformation`)

  const params = ctx.originalParams // 初始化注入
  const apiClient = ctx.apiClientInstance // 初始化注入

  if (!apiClient) {
    console.error(`🔄 [${MIDDLEWARE_NAME}] ApiClient instance not found in context.`)
    throw new Error('ApiClient instance not found in context')
  }

  // 检查是否有requestTransformer方法
  const requestTransformer = apiClient.getRequestTransformer()
  if (!requestTransformer) {
    console.warn(
      `🔄 [${MIDDLEWARE_NAME}] ApiClient does not have getRequestTransformer method, skipping transformation`
    )
    await next()
    return
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
    const transformResult = await requestTransformer.transform(params, assistant, model, apiClient.provider)

    const { payload: sdkPayload, metadata } = transformResult

    // 将SDK特定的payload和metadata存储在状态中，供下游中间件使用
    ctx._internal.sdkPayload = sdkPayload
    if (metadata) {
      ctx._internal.customState = {
        ...ctx._internal.customState,
        sdkMetadata: metadata
      }
    }

    console.log(`🔄 [${MIDDLEWARE_NAME}] Successfully transformed CoreCompletionsRequest to SDK params`)
    console.log(`🔄 [${MIDDLEWARE_NAME}] SDK payload`, sdkPayload)
    console.log(`🔄 [${MIDDLEWARE_NAME}] Has metadata:`, !!metadata)

    await next()
  } catch (error) {
    console.error(`🔄 [${MIDDLEWARE_NAME}] Error during request transformation:`, error)
    // 让错误向上传播，或者可以在这里进行特定的错误处理
    throw error
  }
}
