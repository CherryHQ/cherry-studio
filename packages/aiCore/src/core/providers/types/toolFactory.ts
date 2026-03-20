import type { ProviderV3 } from '@ai-sdk/provider'
import type { ToolSet } from 'ai'

/**
 * 跨 provider 的工具能力标识
 *
 * 各 SDK 的工具键名不同（OpenAI: webSearch, Anthropic: webSearch_20250305, Google: googleSearch），
 * 但表达的是同一种能力。ToolFactoryMap 用 ToolCapability 作为 key，
 * plugin 通过它进行跨 provider 统一查找。
 */
export type ToolCapability = 'webSearch' | 'fileSearch' | 'codeExecution' | 'urlContext'

/**
 * 工具工厂返回的 patch，描述要合并到 params 的修改
 *
 * 一个 capability 可能对应多个工具（如 xAI 的 webSearch + xSearch），
 * 也可能不是工具而是 providerOptions（如 OpenRouter 的 plugins）。
 */
export interface ToolFactoryPatch {
  tools?: ToolSet
  providerOptions?: Record<string, any>
}

/**
 * 工具工厂函数 — 形状约束
 *
 * 使用 `...args: any[]` 而非 `config: Record<string, any>`，
 * 这样 `as const satisfies` 不会擦除声明时的具体 config 类型。
 *
 * 声明时写具体类型：
 * ```typescript
 * toolFactories: {
 *   webSearch: (p: OpenAIProvider) => (config: OpenAISearchConfig) => ({
 *     tools: { webSearch: p.tools.webSearch(config) }
 *   })
 * }
 * ```
 *
 * TypeScript 通过 `p.tools.xxx(config)` 同时校验：
 * 1. SDK 工具键名是否存在
 * 2. config 类型是否兼容 SDK 工具的参数类型
 *
 * 类型工具 `ExtractToolConfig` 可从 `as const` 声明中提取具体 config 类型。
 */
export type ToolFactory<TProvider extends ProviderV3 = ProviderV3> = (
  provider: TProvider
) => (...args: any[]) => ToolFactoryPatch

/**
 * Map of tool capabilities to their factory functions.
 *
 * Key = ToolCapability（跨 provider 逻辑名）
 * Value = 工厂函数（形状约束，不擦除具体 config 类型）
 */
export type ToolFactoryMap<TProvider extends ProviderV3 = ProviderV3> = {
  [K in ToolCapability]?: ToolFactory<TProvider>
}
