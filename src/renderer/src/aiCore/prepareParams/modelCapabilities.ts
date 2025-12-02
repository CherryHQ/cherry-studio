/**
 * 模型能力检查模块
 * 检查不同模型支持的功能（PDF输入、图片输入、大文件上传等）
 */

import { isVisionModel } from '@renderer/config/models'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import { FileTypes } from '@renderer/types'

import { getAiSdkProviderId } from '../provider/factory'

// 工具函数：基于模型名和提供商判断是否支持某特性
function modelSupportValidator(
  model: Model,
  {
    supportedModels = [],
    unsupportedModels = [],
    supportedProviders = [],
    unsupportedProviders = []
  }: {
    supportedModels?: string[]
    unsupportedModels?: string[]
    supportedProviders?: string[]
    unsupportedProviders?: string[]
  }
): boolean {
  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  // 黑名单：命中不支持的模型直接拒绝
  if (unsupportedModels.some((name) => model.name.includes(name))) {
    return false
  }

  // 黑名单：命中不支持的提供商直接拒绝，常用于某些提供商的同名模型并不具备原模型的某些特性
  if (unsupportedProviders.includes(aiSdkId)) {
    return false
  }

  // 白名单：命中支持的模型名
  if (supportedModels.some((name) => model.name.includes(name))) {
    return true
  }

  // 回退到提供商判断
  return supportedProviders.includes(aiSdkId)
}

/**
 * 检查模型是否支持原生PDF输入
 */
export function supportsPdfInput(model: Model): boolean {
  // 基于AI SDK文档，以下模型或提供商支持PDF输入
  return modelSupportValidator(model, {
    supportedModels: ['qwen-long', 'qwen-doc'],
    supportedProviders: [
      'openai',
      'azure-openai',
      'anthropic',
      'google',
      'google-generative-ai',
      'google-vertex',
      'bedrock',
      'amazon-bedrock'
    ]
  })
}

/**
 * 检查模型是否支持原生图片输入
 */
export function supportsImageInput(model: Model): boolean {
  return isVisionModel(model)
}

/**
 * 检查提供商是否支持大文件上传（如Gemini File API）
 */
export function supportsLargeFileUpload(model: Model): boolean {
  // 基于AI SDK文档，以下模型或提供商支持大文件上传
  return modelSupportValidator(model, {
    supportedModels: ['qwen-long', 'qwen-doc'],
    supportedProviders: ['google', 'google-generative-ai', 'google-vertex']
  })
}

/**
 * 获取提供商特定的文件大小限制
 */
export function getFileSizeLimit(model: Model, fileType: FileTypes): number {
  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  // Anthropic PDF限制32MB
  if (aiSdkId === 'anthropic' && fileType === FileTypes.DOCUMENT) {
    return 32 * 1024 * 1024 // 32MB
  }

  // Gemini小文件限制20MB（超过此限制会使用File API上传）
  if (['google', 'google-generative-ai', 'google-vertex'].includes(aiSdkId)) {
    return 20 * 1024 * 1024 // 20MB
  }

  // Dashscope如果模型支持大文件上传优先使用File API上传
  if (aiSdkId === 'dashscope' && supportsLargeFileUpload(model)) {
    return 0 // 使用较小的默认值
  }

  // 其他提供商没有明确限制，使用较大的默认值
  // 这与Legacy架构中的实现一致，让提供商自行处理文件大小
  return Infinity
}
