import type { ProviderV3 } from '@ai-sdk/provider'
import type { ToolSet } from 'ai'

/**
 * 跨 provider 的工具能力标识
 *
 * 各 SDK 的工具键名不同（OpenAI: webSearch, Anthropic: webSearch_20250305, Google: googleSearch），
 * 但表达的是同一种能力。Plugin 通过 ToolCapability 进行跨 provider 统一查找。
 */
export type ToolCapability = 'webSearch' | 'fileSearch' | 'codeExecution' | 'urlContext'

/** 工具工厂返回的 patch，描述要合并到 params 的修改 */
export interface ToolFactoryPatch {
  tools?: ToolSet
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
