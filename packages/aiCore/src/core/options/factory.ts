import type { ExtractProviderOptions, ProviderOptionsMap, TypedProviderOptions } from './types'

/**
 * 创建特定供应商的选项
 * @param provider 供应商名称
 * @param options 供应商特定的选项
 * @returns 格式化的provider options
 */
export function createProviderOptions<T extends keyof ProviderOptionsMap>(
  provider: T,
  options: ExtractProviderOptions<T>
): Record<T, ExtractProviderOptions<T>> {
  return { [provider]: options } as Record<T, ExtractProviderOptions<T>>
}

/**
 * 创建任意供应商的选项（包括未知供应商）
 * @param provider 供应商名称
 * @param options 供应商选项
 * @returns 格式化的provider options
 */
export function createGenericProviderOptions<T extends string>(
  provider: T,
  options: Record<string, any>
): Record<T, Record<string, any>> {
  return { [provider]: options } as Record<T, Record<string, any>>
}

type PlainObject = Record<string, any>

const isPlainObject = (value: unknown): value is PlainObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMergeObjects<T extends PlainObject>(target: T, source: PlainObject): T {
  const result: PlainObject = { ...target }
  Object.entries(source).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMergeObjects(result[key], value)
    } else {
      result[key] = value
    }
  })
  return result as T
}

/**
 * 合并多个供应商的options
 * @param optionsMap 包含多个供应商选项的对象
 * @returns 合并后的TypedProviderOptions
 */
export function mergeProviderOptions(...optionsMap: Partial<TypedProviderOptions>[]): TypedProviderOptions {
  return optionsMap.reduce<TypedProviderOptions>((acc, options) => {
    if (!options) {
      return acc
    }
    Object.entries(options).forEach(([providerId, providerOptions]) => {
      if (!providerOptions) {
        return
      }
      if (acc[providerId]) {
        acc[providerId] = deepMergeObjects(acc[providerId] as PlainObject, providerOptions as PlainObject)
      } else {
        acc[providerId] = providerOptions as any
      }
    })
    return acc
  }, {} as TypedProviderOptions)
}

/**
 * 创建OpenAI供应商选项的便捷函数
 */
export function createOpenAIOptions(options: ExtractProviderOptions<'openai'>) {
  return createProviderOptions('openai', options)
}

/**
 * 创建Anthropic供应商选项的便捷函数
 */
export function createAnthropicOptions(options: ExtractProviderOptions<'anthropic'>) {
  return createProviderOptions('anthropic', options)
}

/**
 * 创建Google供应商选项的便捷函数
 */
export function createGoogleOptions(options: ExtractProviderOptions<'google'>) {
  return createProviderOptions('google', options)
}

/**
 * 创建OpenRouter供应商选项的便捷函数
 */
export function createOpenRouterOptions(options: ExtractProviderOptions<'openrouter'> | Record<string, any>) {
  return createProviderOptions('openrouter', options)
}

/**
 * 创建XAI供应商选项的便捷函数
 */
export function createXaiOptions(options: ExtractProviderOptions<'xai'>) {
  return createProviderOptions('xai', options)
}
