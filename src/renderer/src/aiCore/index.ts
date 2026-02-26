/**
 * Cherry Studio AI Core - 统一入口点
 *
 * 使用 ModernAiProvider 作为默认导出
 * Legacy provider 已移除
 */

import ModernAiProvider from './index_new'

// 默认导出和命名导出
export default ModernAiProvider
export { ModernAiProvider }
