/**
 * 模型能力检查模块
 * 检查不同模型支持的功能（PDF输入、图片输入、大文件上传等）
 */

import { isVisionModel } from '@renderer/config/models'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import { FileTypes } from '@renderer/types'

import { getAiSdkProviderId } from '../provider/factory'

/**
 * 检查模型是否支持原生PDF输入
 */
export function supportsPdfInput(model: Model): boolean {
  // 基于AI SDK文档，这些提供商支持PDF输入
  const supportedProviders = [
    'openai',
    'azure-openai',
    'anthropic',
    'google',
    'google-generative-ai',
    'google-vertex',
    'bedrock',
    'amazon-bedrock'
  ]

  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  return supportedProviders.some((provider) => aiSdkId === provider)
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
  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  // 目前主要是Gemini系列支持大文件上传
  return ['google', 'google-generative-ai', 'google-vertex'].includes(aiSdkId)
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

  // 其他提供商没有明确限制，使用较大的默认值
  // 这与Legacy架构中的实现一致，让提供商自行处理文件大小
  return Infinity
}
