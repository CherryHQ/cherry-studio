/**
 * 内置插件命名空间
 * 所有内置插件都以 'built-in:' 为前缀
 */
export const BUILT_IN_PLUGIN_PREFIX = 'built-in:'

export { googleToolsPlugin } from './googleToolsPlugin'
export { createLoggingPlugin } from './logging'
export { createPromptToolUsePlugin } from './toolUsePlugin/promptToolUsePlugin'
export type {
  PromptToolUseConfig,
  ToolUseRequestContext,
  ToolUseResult
} from './toolUsePlugin/type'
export { webSearchPlugin, type WebSearchPluginConfig } from './webSearchPlugin'
