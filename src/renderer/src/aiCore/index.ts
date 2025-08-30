/**
 * Cherry Studio AI Core - 统一入口点
 *
 * 这是新的统一入口，保持向后兼容性
 * 默认导出legacy AiProvider以保持现有代码的兼容性
 */

// 导出Legacy AiProvider作为默认导出（保持向后兼容）
export { default } from './legacy/index'

// 同时导出Modern AiProvider供新代码使用
export { default as ModernAiProvider } from './index_new'

// 导出一些常用的类型和工具
export * from './legacy/clients/types'
export * from './legacy/middleware/schemas'
