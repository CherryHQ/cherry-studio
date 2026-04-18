import type { ProviderV3 } from '@ai-sdk/provider'

/**
 * 跨 provider 的工具能力标识
 *
 * 各 SDK 的工具键名不同（OpenAI: webSearch, Anthropic: webSearch_20250305, Google: googleSearch），
 * 但表达的是同一种能力。Plugin 通过 ToolCapability 进行跨 provider 统一查找。
 */
export type ToolCapability = 'webSearch' | 'fileSearch' | 'codeExecution' | 'urlContext'

/**
 * 工具工厂返回的 patch，描述要合并到 params 的修改。
 *
 * `tools` 使用 `Record<string, any>` 而非 `ai` 的 `ToolSet`：各 provider 工厂
 * 返回的 `Tool<INPUT, OUTPUT>` 泛型越来越具体（如 Anthropic 3.0.71 的
 * `webSearch_20260209` OUTPUT 是 `{ type: 'web_search_result', ... }[]`），
 * 这些具体类型不再可赋值给 `ToolSet` 的 `Tool<any, any> | Tool<any, never> |
 * Tool<never, any> | Tool<never, never>` 交集。运行时只是浅拷贝到
 * `params.tools`，形状等价。
 */
export interface ToolFactoryPatch {
  tools?: Record<string, any>
  providerOptions?: Record<string, any>
}

/**
 * 工具工厂函数 — 形状约束
 *
 * 使用 `...args: any[]` 而非 `config: Record<string, any>`，
 * 这样 `as const satisfies` 不会擦除声明时的具体 config 类型。
 * `ExtractToolConfig` 可从声明中提取具体 config 类型。
 */
export type ToolFactory<TProvider extends ProviderV3 = ProviderV3> = (
  provider: TProvider
) => (...args: any[]) => ToolFactoryPatch

/** Map of ToolCapability keys to their factory functions. */
export type ToolFactoryMap<TProvider extends ProviderV3 = ProviderV3> = {
  [K in ToolCapability]?: ToolFactory<TProvider>
}
