/**
 * 模型创建器
 * 负责创建模型并应用中间件，不暴露原始model给用户
 */
import { LanguageModel } from 'ai'

import { wrapModelWithMiddlewares } from '../middleware'
import { createBaseModel } from './ProviderCreator'
import { ModelCreationRequest, ResolvedConfig } from './types'

/**
 * 根据解析后的配置创建包装好的模型
 */
export async function createModelFromConfig(config: ResolvedConfig): Promise<LanguageModel> {
  // 使用ProviderCreator创建基础模型（不应用中间件）
  const baseModel = await createBaseModel(config.provider.id, config.model.id, config.provider.options)

  // 在creation层应用中间件，用户不直接接触原始model
  return wrapModelWithMiddlewares(baseModel, config.middlewares)
}

/**
 * 直接根据请求参数创建模型
 */
export async function createModel(request: ModelCreationRequest): Promise<LanguageModel> {
  // 使用ProviderCreator创建基础模型（不应用中间件）
  const baseModel = await createBaseModel(request.providerId, request.modelId, request.options)

  const middlewares = request.middlewares || []
  return wrapModelWithMiddlewares(baseModel, middlewares)
}
