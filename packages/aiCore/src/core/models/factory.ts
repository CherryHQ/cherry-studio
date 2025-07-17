/**
 * 模型工厂函数
 * 统一的模型创建和配置管理
 */
import { LanguageModelV2 } from '@ai-sdk/provider'
import { LanguageModel } from 'ai'

import { wrapModelWithMiddlewares } from '../middleware'
import { createBaseModel } from './ProviderCreator'
import { ModelConfig } from './types'

/**
 * 创建模型 - 核心函数
 */
export async function createModel(config: ModelConfig): Promise<LanguageModelV2> {
  validateModelConfig(config)

  // 1. 创建基础模型
  const baseModel = await createBaseModel(config)

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
  if (!config.providerSettings) {
    throw new Error('ModelConfig: providerSettings is required')
  }
}
