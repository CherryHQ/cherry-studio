/**
 * 模型工厂函数
 * 统一的模型创建和配置管理
 */
import { LanguageModel, LanguageModelV1Middleware } from 'ai'

import { type ProviderId, type ProviderSettingsMap } from '../../types'
import { wrapModelWithMiddlewares } from '../middleware'
import { createBaseModel } from './ProviderCreator'

export interface ModelConfig {
  providerId: ProviderId
  modelId: string
  options: ProviderSettingsMap[ProviderId]
  middlewares?: LanguageModelV1Middleware[]
}

/**
 * 创建模型 - 核心函数
 */
export async function createModel(config: ModelConfig): Promise<LanguageModel> {
  validateModelConfig(config)

  // 1. 创建基础模型
  const baseModel = await createBaseModel(config.providerId, config.modelId, config.options)

  // 2. 应用中间件（如果有）
  return config.middlewares?.length ? wrapModelWithMiddlewares(baseModel, config.middlewares) : baseModel
}

/**
 * 批量创建模型
 */
export async function createModels(configs: ModelConfig[]): Promise<LanguageModel[]> {
  return Promise.all(configs.map((config) => createModel(config)))
}

/**
 * 验证模型配置
 */
function validateModelConfig(config: ModelConfig): void {
  if (!config.providerId) {
    throw new Error('ModelConfig: providerId is required')
  }
  if (!config.modelId) {
    throw new Error('ModelConfig: modelId is required')
  }
  if (!config.options) {
    throw new Error('ModelConfig: options is required')
  }
}
