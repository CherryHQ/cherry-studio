/**
 * Provider Creator
 * 负责根据 ProviderConfig 创建 provider 实例
 */

import { type ProviderConfig } from './types'

// 错误类型
export class ProviderCreationError extends Error {
  constructor(
    message: string,
    public providerId?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ProviderCreationError'
  }
}

/**
 * 创建 Provider 实例
 * 支持两种模式：直接提供 creator 函数，或动态导入 + 函数名
 */
export async function createProvider(config: ProviderConfig, options: any): Promise<any> {
  try {
    // 验证配置
    if (!validateProviderConfig(config)) {
      throw new ProviderCreationError(
        'Invalid provider configuration: must provide either creator function or import configuration',
        config.id
      )
    }

    config.validateOptions?.(options)

    // 方式一：直接使用 creator 函数
    if (config.creator) {
      return config.creator(options)
    }

    // 方式二：动态导入 + 函数名
    if (config.import && config.creatorFunctionName) {
      const module = await config.import()
      const creatorFunction = module[config.creatorFunctionName]

      if (typeof creatorFunction !== 'function') {
        throw new ProviderCreationError(
          `Creator function "${config.creatorFunctionName}" not found in the imported module`,
          config.id
        )
      }

      return creatorFunction(options)
    }

    throw new ProviderCreationError('Unexpected provider configuration state', config.id)
  } catch (error) {
    if (error instanceof ProviderCreationError) {
      throw error
    }
    throw new ProviderCreationError(
      `Failed to create provider "${config.id}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      config.id,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * 创建图像生成 Provider 实例
 */
export async function createImageProvider(config: ProviderConfig, options: any): Promise<any> {
  try {
    if (!config.supportsImageGeneration) {
      throw new ProviderCreationError(`Provider "${config.id}" does not support image generation`, config.id)
    }

    // 如果有专门的图像 creator
    if (config.imageCreator) {
      return config.imageCreator(options)
    }

    // 否则使用普通的 provider 创建流程
    return await createProvider(config, options)
  } catch (error) {
    if (error instanceof ProviderCreationError) {
      throw error
    }
    throw new ProviderCreationError(
      `Failed to create image provider "${config.id}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      config.id,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * 验证 Provider 配置
 */
export function validateProviderConfig(config: ProviderConfig): boolean {
  if (!config.id || !config.name) {
    return false
  }

  if (!config.creator && !(config.import && config.creatorFunctionName)) {
    return false
  }

  return true
}
