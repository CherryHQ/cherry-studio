/**
 * Extension Registry
 * 管理所有 Provider Extensions 的注册、查询和实例化
 */

import type { ProviderV3 } from '@ai-sdk/provider'

import type { CoreProviderSettingsMap, RegisteredProviderId } from '../index'
import { type ProviderExtension } from './ProviderExtension'
import { ProviderCreationError } from './utils'

/**
 * Provider Extension 注册表
 *
 * 职责:
 * - 注册和管理 Provider Extensions
 * - 根据 ID 查找对应的 Extension
 * - 创建并注册 provider 实例（包括变体）
 *
 * @example
 * ```typescript
 * import { extensionRegistry } from '@cherrystudio/ai-core/provider'
 * import { OpenAIExtension } from './extensions/openai'
 *
 * // 注册 extension
 * extensionRegistry.register(OpenAIExtension)
 *
 * // 批量注册
 * extensionRegistry.registerAll([
 *   OpenAIExtension,
 *   AzureExtension,
 *   AnthropicExtension
 * ])
 *
 * // 创建并注册 provider 实例
 * await extensionRegistry.createAndRegisterProvider('openai', {
 *   apiKey: 'sk-xxx'
 * })
 * ```
 */
export class ExtensionRegistry {
  /** Extension 存储: name -> Extension */
  private extensions: Map<string, ProviderExtension<any, any, any>> = new Map()

  /** 别名映射: alias -> name */
  private aliasMap: Map<string, string> = new Map()

  /**
   * 注册单个 Extension
   * 支持链式调用
   */
  register(extension: ProviderExtension<any, any, any>): this {
    const { name, aliases, variants } = extension.config

    if (this.extensions.has(name)) {
      throw new Error(`Provider extension "${name}" is already registered`)
    }

    this.extensions.set(name, extension)

    if (aliases) {
      for (const alias of aliases) {
        if (this.aliasMap.has(alias)) {
          throw new Error(`Provider alias "${alias}" is already registered for "${this.aliasMap.get(alias)}"`)
        }
        this.aliasMap.set(alias, name)
      }
    }

    if (variants) {
      for (const variant of variants) {
        const variantId = `${name}-${variant.suffix}`
        if (this.aliasMap.has(variantId)) {
          throw new Error(
            `Provider variant ID "${variantId}" is already registered for "${this.aliasMap.get(variantId)}"`
          )
        }
        this.aliasMap.set(variantId, name)
      }
    }

    return this
  }

  /**
   * 批量注册 Extensions
   * 支持 readonly 数组（用于 as const 数组）
   */
  registerAll(extensions: readonly ProviderExtension<any, any, any, any>[]): this {
    for (const ext of extensions) {
      this.register(ext)
    }
    return this
  }

  /**
   * 取消注册 Extension
   */
  unregister(name: string): boolean {
    const extension = this.extensions.get(name)
    if (!extension) {
      return false
    }

    this.extensions.delete(name)

    if (extension.config.aliases) {
      for (const alias of extension.config.aliases) {
        this.aliasMap.delete(alias)
      }
    }

    if (extension.config.variants) {
      for (const variant of extension.config.variants) {
        this.aliasMap.delete(`${name}-${variant.suffix}`)
      }
    }

    return true
  }

  /**
   * 获取 Extension（支持别名）
   */
  get(id: string): ProviderExtension<any, any, any> | undefined {
    if (this.extensions.has(id)) {
      return this.extensions.get(id)
    }

    const realName = this.aliasMap.get(id)
    if (realName) {
      return this.extensions.get(realName)
    }

    return undefined
  }

  /**
   * 获取 Extension
   *
   * @param id - Provider ID（必须是 RegisteredProviderId）
   * @returns Extension 或 undefined
   *
   * @example
   * ```typescript
   * const ext = extensionRegistry.getTyped('openai')
   * if (ext) {
   *   const provider = await ext.createProvider({
   *     apiKey: 'sk-...'
   *   })
   * }
   * ```
   */
  getTyped<T extends RegisteredProviderId>(id: T): ProviderExtension<any, any, any> | undefined {
    return this.get(id)
  }

  /**
   * 检查 Extension 是否已注册
   */
  has(id: string): boolean {
    return this.extensions.has(id) || this.aliasMap.has(id)
  }

  /**
   * 获取所有已注册的 Extension
   */
  getAll(): ProviderExtension<any, any, any>[] {
    return Array.from(this.extensions.values())
  }

  /**
   * 获取所有已注册的 provider IDs（包含变体）
   * 返回类型安全的 RegisteredProviderId 数组，自动去重
   */
  getAllProviderIds(): RegisteredProviderId[] {
    const ids = new Set<string>()

    for (const extension of this.extensions.values()) {
      for (const id of extension.getProviderIds()) {
        ids.add(id)
      }
    }

    return Array.from(ids) as RegisteredProviderId[]
  }

  /**
   * 根据 base ID + mode 解析到完整的 provider ID
   *
   * 支持别名：如果 baseId 是别名，会先解析到规范 ID
   *
   * @param baseId - 基础 provider ID（可以是别名）
   * @param mode - 模式（如 'chat', 'responses'）
   * @returns 完整的 provider ID，如果无法解析则返回 null
   *
   * @example
   * ```typescript
   * resolveProviderIdWithMode('openai', 'chat')        // → 'openai-chat'
   * resolveProviderIdWithMode('azure', 'responses')    // → 'azure-responses'
   * resolveProviderIdWithMode('gemini', 'chat')        // → null (google 没有 chat 变体)
   * resolveProviderIdWithMode('openai')                // → 'openai' (没有 mode)
   * ```
   */
  resolveProviderIdWithMode(baseId: string, mode?: string): string | null {
    // 如果没有 mode，直接返回解析后的 ID
    if (!mode) {
      const extension = this.get(baseId)
      return extension ? extension.config.name : null
    }

    // 获取 extension（支持别名）
    const extension = this.get(baseId)
    if (!extension) {
      return null
    }

    // 检查是否有对应的变体
    if (!extension.config.variants) {
      return null
    }

    // 查找匹配的变体
    const variant = extension.config.variants.find((v) => v.suffix === mode)
    if (!variant) {
      return null
    }

    // 返回变体 ID: ${name}-${suffix}
    return `${extension.config.name}-${variant.suffix}`
  }

  /**
   * 反向解析：从完整 ID 提取 base ID 和 mode
   *
   * 遍历所有 extensions 的变体，匹配 `${name}-${suffix}` 模式
   *
   * @param providerId - 完整的 provider ID
   * @returns 解析结果，如果无法解析返回 null
   *
   * @example
   * ```typescript
   * parseProviderId('openai-chat')        // → { baseId: 'openai', mode: 'chat', isVariant: true }
   * parseProviderId('azure-responses')    // → { baseId: 'azure', mode: 'responses', isVariant: true }
   * parseProviderId('openai')             // → { baseId: 'openai', isVariant: false }
   * parseProviderId('oai')                // → { baseId: 'openai', isVariant: false } (别名)
   * parseProviderId('unknown')            // → null
   * ```
   */
  parseProviderId(providerId: string): { baseId: RegisteredProviderId; mode?: string; isVariant: boolean } | null {
    // 先遍历所有 extensions，查找匹配的变体（优先于别名检查）
    for (const ext of this.extensions.values()) {
      if (!ext.config.variants) {
        continue
      }

      // 检查每个变体
      for (const variant of ext.config.variants) {
        const variantId = `${ext.config.name}-${variant.suffix}`
        if (variantId === providerId) {
          return {
            baseId: ext.config.name as RegisteredProviderId,
            mode: variant.suffix,
            isVariant: true
          }
        }
      }
    }

    // 再检查是否是已注册的 extension（直接或通过别名）
    const extension = this.get(providerId)
    if (extension) {
      // 是基础 ID 或别名，不是变体
      return {
        baseId: extension.config.name as RegisteredProviderId,
        isVariant: false
      }
    }

    // 无法解析
    return null
  }

  /**
   * 检查是否为变体 ID
   *
   * @param id - Provider ID
   * @returns 如果是变体 ID 返回 true
   *
   * @example
   * ```typescript
   * isVariant('openai-chat')      // → true
   * isVariant('azure-responses')  // → true
   * isVariant('openai')           // → false
   * isVariant('unknown')          // → false
   * ```
   */
  isVariant(id: string): boolean {
    const parsed = this.parseProviderId(id)
    return parsed?.isVariant ?? false
  }

  /**
   * 获取基础 provider ID
   *
   * 对于变体ID，返回其基础provider ID；
   * 对于基础ID或别名，返回规范的provider ID；
   * 对于未知ID，返回null
   *
   * @param id - Provider ID（可以是基础ID、变体ID或别名）
   * @returns 基础 provider ID，如果无法解析则返回 null
   *
   * @example
   * ```typescript
   * getBaseProviderId('openai-chat')      // → 'openai' (变体)
   * getBaseProviderId('azure-responses')  // → 'azure' (变体)
   * getBaseProviderId('openai')           // → 'openai' (基础ID)
   * getBaseProviderId('oai')              // → 'openai' (别名)
   * getBaseProviderId('unknown')          // → null
   * ```
   */
  getBaseProviderId(id: string): RegisteredProviderId | null {
    const parsed = this.parseProviderId(id)
    return parsed?.baseId ?? null
  }

  /**
   * 获取变体的模式/后缀
   *
   * @param variantId - 变体 ID
   * @returns 模式/后缀，如果不是变体则返回 null
   *
   * @example
   * ```typescript
   * getVariantMode('openai-chat')      // → 'chat'
   * getVariantMode('azure-responses')  // → 'responses'
   * getVariantMode('openai')           // → null (不是变体)
   * getVariantMode('unknown')          // → null
   * ```
   */
  getVariantMode(variantId: string): string | null {
    const parsed = this.parseProviderId(variantId)
    return parsed?.mode ?? null
  }

  /**
   * 获取某个基础 provider 的所有变体 IDs
   *
   * @param baseId - 基础 provider ID（可以是别名）
   * @returns 变体 ID 数组，如果没有变体则返回空数组
   *
   * @example
   * ```typescript
   * getVariants('openai')   // → ['openai-chat']
   * getVariants('azure')    // → ['azure-responses']
   * getVariants('google')   // → ['google-chat']
   * getVariants('xai')      // → [] (没有变体)
   * getVariants('unknown')  // → [] (未注册)
   * ```
   */
  getVariants(baseId: string): string[] {
    const extension = this.get(baseId)
    if (!extension?.config.variants) {
      return []
    }

    return extension.config.variants.map((v) => `${extension.config.name}-${v.suffix}`)
  }

  /**
   * 清空所有注册
   */
  clear(): void {
    this.extensions.clear()
    this.aliasMap.clear()
  }

  /**
   * 创建 provider 实例
   *
   * 支持两种调用方式:
   * 1. 类型安全版本 - 使用已注册的 provider ID，获得完整的类型推导
   * 2. 动态版本 - 使用任意字符串 ID，用于测试或动态注册的 provider
   *
   * @param id - Provider ID
   * @param settings - Provider 配置
   * @returns Provider 实例
   */
  async createProvider<T extends RegisteredProviderId>(id: T, settings: CoreProviderSettingsMap[T]): Promise<ProviderV3>
  async createProvider(id: string, settings?: unknown): Promise<ProviderV3>
  async createProvider(id: string, settings?: unknown): Promise<ProviderV3> {
    const parsed = this.parseProviderId(id)
    if (!parsed) {
      throw new Error(`Provider extension "${id}" not found. Did you forget to register it?`)
    }

    const { baseId, mode: variantSuffix } = parsed

    const extension = this.get(baseId)
    if (!extension) {
      throw new Error(`Provider extension "${baseId}" not found. Did you forget to register it?`)
    }

    try {
      return await extension.createProvider(settings, variantSuffix)
    } catch (error) {
      throw new ProviderCreationError(
        `Failed to create provider "${id}"`,
        id,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }
}

/**
 * 全局 Extension Registry 实例
 * 单例模式，确保整个应用只有一个注册表
 */
export const extensionRegistry = new ExtensionRegistry()
