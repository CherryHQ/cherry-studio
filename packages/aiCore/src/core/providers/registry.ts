/**
 * Provider 初始化器
 * 负责根据配置创建 providers 并注册到全局管理器
 * 集成了来自 ModelCreator 的特殊处理逻辑
 */

import { customProvider } from 'ai'

import { globalRegistryManagement } from './RegistryManagement'
import { baseProviders, type ProviderConfig } from './schemas'

/**
 * Provider 初始化错误类型
 */
class ProviderInitializationError extends Error {
  constructor(
    message: string,
    public providerId?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ProviderInitializationError'
  }
}

// ==================== 全局管理器导出 ====================

export { globalRegistryManagement as providerRegistry }

// ==================== 便捷访问方法 ====================

export const getLanguageModel = (id: string) => globalRegistryManagement.languageModel(id as any)
export const getTextEmbeddingModel = (id: string) => globalRegistryManagement.textEmbeddingModel(id as any)
export const getImageModel = (id: string) => globalRegistryManagement.imageModel(id as any)

// ==================== 工具函数 ====================

/**
 * 获取支持的 Providers 列表
 */
export function getSupportedProviders(): Array<{
  id: string
  name: string
}> {
  return baseProviders.map((provider) => ({
    id: provider.id,
    name: provider.name
  }))
}

/**
 * 获取所有已初始化的 providers
 */
export function getInitializedProviders(): string[] {
  return globalRegistryManagement.getRegisteredProviders()
}

/**
 * 检查是否有任何已初始化的 providers
 */
export function hasInitializedProviders(): boolean {
  return globalRegistryManagement.hasProviders()
}

// ==================== 统一Provider配置系统 ====================

// 全局Provider配置存储
const providerConfigs = new Map<string, ProviderConfig>()
// 全局ProviderConfig别名映射 - 借鉴RegistryManagement模式
const providerConfigAliases = new Map<string, string>() // alias -> realId

/**
 * 初始化内置配置 - 将baseProviders转换为统一格式
 */
function initializeBuiltInConfigs(): void {
  baseProviders.forEach((provider) => {
    const config: ProviderConfig = {
      id: provider.id,
      name: provider.name,
      creator: provider.creator as any, // 类型转换以兼容多种creator签名
      supportsImageGeneration: provider.supportsImageGeneration || false
    }
    providerConfigs.set(provider.id, config)
  })
}

// 启动时自动注册内置配置
initializeBuiltInConfigs()

/**
 * 步骤1: 注册Provider配置 - 仅存储配置，不执行创建
 */
export function registerProviderConfig(config: ProviderConfig): boolean {
  try {
    // 验证配置
    if (!config || !config.id || !config.name) {
      return false
    }

    // 检查是否与已有配置冲突（包括内置配置）
    if (providerConfigs.has(config.id)) {
      console.warn(`ProviderConfig "${config.id}" already exists, will override`)
    }

    // 存储配置（内置和用户配置统一处理）
    providerConfigs.set(config.id, config)

    //  处理别名
    if (config.aliases && config.aliases.length > 0) {
      config.aliases.forEach((alias) => {
        if (providerConfigAliases.has(alias)) {
          console.warn(`ProviderConfig alias "${alias}" already exists, will override`)
        }
        providerConfigAliases.set(alias, config.id)
      })
    }

    return true
  } catch (error) {
    console.error(`Failed to register ProviderConfig:`, error)
    return false
  }
}

/**
 * 步骤2: 创建Provider - 根据配置执行实际创建
 */
export async function createProvider(providerId: string, options: any): Promise<any> {
  //  支持通过别名查找配置
  const config = getProviderConfigByAlias(providerId)

  if (!config) {
    throw new Error(`ProviderConfig not found for id: ${providerId}`)
  }

  try {
    let creator: (options: any) => any

    if (config.creator) {
      // 方式1: 直接执行 creator
      creator = config.creator
    } else if (config.import && config.creatorFunctionName) {
      // 方式2: 动态导入并执行
      const module = await config.import()
      creator = (module as any)[config.creatorFunctionName]

      if (!creator || typeof creator !== 'function') {
        throw new Error(`Creator function "${config.creatorFunctionName}" not found in imported module`)
      }
    } else {
      throw new Error('No valid creator method provided in ProviderConfig')
    }

    // 使用真实配置创建provider实例
    return creator(options)
  } catch (error) {
    console.error(`Failed to create provider "${providerId}":`, error)
    throw error
  }
}

/**
 * 步骤3: 注册Provider到全局管理器
 */
export function registerProvider(providerId: string, provider: any): boolean {
  try {
    const config = providerConfigs.get(providerId)
    if (!config) {
      console.error(`ProviderConfig not found for id: ${providerId}`)
      return false
    }

    // 获取aliases配置
    const aliases = config.aliases

    // 处理特殊provider逻辑
    if (providerId === 'openai') {
      // 注册默认 openai
      globalRegistryManagement.registerProvider(providerId, provider, aliases)

      // 创建并注册 openai-chat 变体
      const openaiChatProvider = customProvider({
        fallbackProvider: {
          ...provider,
          languageModel: (modelId: string) => provider.chat(modelId)
        }
      })
      globalRegistryManagement.registerProvider(`${providerId}-chat`, openaiChatProvider)
    } else if (providerId === 'azure') {
      globalRegistryManagement.registerProvider(`${providerId}-chat`, provider, aliases)
      // 跟上面相反,creator产出的默认会调用chat
      const azureResponsesProvider = customProvider({
        fallbackProvider: {
          ...provider,
          languageModel: (modelId: string) => provider.responses(modelId)
        }
      })
      globalRegistryManagement.registerProvider(providerId, azureResponsesProvider)
    } else {
      // 其他provider直接注册
      globalRegistryManagement.registerProvider(providerId, provider, aliases)
    }

    return true
  } catch (error) {
    console.error(`Failed to register provider "${providerId}" to global registry:`, error)
    return false
  }
}

/**
 * 便捷函数: 一次性完成创建+注册
 */
export async function createAndRegisterProvider(providerId: string, options: any): Promise<boolean> {
  try {
    // 步骤2: 创建provider
    const provider = await createProvider(providerId, options)

    // 步骤3: 注册到全局管理器
    return registerProvider(providerId, provider)
  } catch (error) {
    console.error(`Failed to create and register provider "${providerId}":`, error)
    return false
  }
}

/**
 * 批量注册Provider配置
 */
export function registerMultipleProviderConfigs(configs: ProviderConfig[]): number {
  let successCount = 0
  configs.forEach((config) => {
    if (registerProviderConfig(config)) {
      successCount++
    }
  })
  return successCount
}

/**
 * 检查是否有对应的Provider配置
 */
export function hasProviderConfig(providerId: string): boolean {
  return providerConfigs.has(providerId)
}

/**
 * 通过别名或ID检查是否有对应的Provider配置
 */
export function hasProviderConfigByAlias(aliasOrId: string): boolean {
  const realId = resolveProviderConfigId(aliasOrId)
  return providerConfigs.has(realId)
}

/**
 * 获取所有Provider配置
 */
export function getAllProviderConfigs(): ProviderConfig[] {
  return Array.from(providerConfigs.values())
}

/**
 * 根据ID获取Provider配置
 */
export function getProviderConfig(providerId: string): ProviderConfig | undefined {
  return providerConfigs.get(providerId)
}

/**
 * 通过别名或ID获取Provider配置
 */
export function getProviderConfigByAlias(aliasOrId: string): ProviderConfig | undefined {
  // 先检查是否为别名，如果是则解析为真实ID
  const realId = providerConfigAliases.get(aliasOrId) || aliasOrId
  return providerConfigs.get(realId)
}

/**
 * 解析真实的ProviderConfig ID（去别名化）
 */
export function resolveProviderConfigId(aliasOrId: string): string {
  return providerConfigAliases.get(aliasOrId) || aliasOrId
}

/**
 * 检查是否为ProviderConfig别名
 */
export function isProviderConfigAlias(id: string): boolean {
  return providerConfigAliases.has(id)
}

/**
 * 获取所有ProviderConfig别名映射关系
 */
export function getAllProviderConfigAliases(): Record<string, string> {
  const result: Record<string, string> = {}
  providerConfigAliases.forEach((realId, alias) => {
    result[alias] = realId
  })
  return result
}

/**
 * 清理所有Provider配置和已注册的providers
 */
export function cleanup(): void {
  providerConfigs.clear()
  providerConfigAliases.clear() //  清理别名映射
  globalRegistryManagement.clear()
  // 重新初始化内置配置
  initializeBuiltInConfigs()
}

export function clearAllProviders(): void {
  globalRegistryManagement.clear()
}

// ==================== 导出错误类型 ====================

export { ProviderInitializationError }
