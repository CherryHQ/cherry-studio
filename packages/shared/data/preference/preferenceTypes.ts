import type { PreferenceSchemas } from './preferenceSchemas'

export type PreferenceDefaultScopeType = PreferenceSchemas['default']
export type PreferenceKeyType = keyof PreferenceDefaultScopeType

/**
 * Result type for getMultipleRaw - maps requested keys to their values
 */
export type PreferenceMultipleResultType<K extends PreferenceKeyType> = {
  [P in K]: PreferenceDefaultScopeType[P]
}

export type PreferenceUpdateOptions = {
  optimistic: boolean
}

export type PreferenceShortcutType = {
  key: string[]
  editable: boolean
  enabled: boolean
  system: boolean
}

export enum SelectionTriggerMode {
  Selected = 'selected',
  Ctrlkey = 'ctrlkey',
  Shortcut = 'shortcut'
}

export enum SelectionFilterMode {
  Default = 'default',
  Whitelist = 'whitelist',
  Blacklist = 'blacklist'
}

export type SelectionActionItem = {
  id: string
  name: string
  enabled: boolean
  isBuiltIn: boolean
  icon?: string
  prompt?: string
  assistantId?: string
  selectedText?: string
  searchEngine?: string
}

export enum ThemeMode {
  light = 'light',
  dark = 'dark',
  system = 'system'
}

/** 有限的UI语言 */
export type LanguageVarious =
  | 'zh-CN'
  | 'zh-TW'
  | 'de-DE'
  | 'el-GR'
  | 'en-US'
  | 'es-ES'
  | 'fr-FR'
  | 'ja-JP'
  | 'pt-PT'
  | 'ro-RO'
  | 'ru-RU'

export type WindowStyle = 'transparent' | 'opaque'

export type SendMessageShortcut = 'Enter' | 'Shift+Enter' | 'Ctrl+Enter' | 'Command+Enter' | 'Alt+Enter'

export type AssistantTabSortType = 'tags' | 'list'

export type SidebarIcon =
  | 'assistants'
  | 'store'
  | 'paintings'
  | 'translate'
  | 'minapp'
  | 'knowledge'
  | 'files'
  | 'code_tools'
  | 'notes'

export type AssistantIconType = 'model' | 'emoji' | 'none'

export type ProxyMode = 'system' | 'custom' | 'none'

export type MultiModelFoldDisplayMode = 'expanded' | 'compact'

export type MathEngine = 'KaTeX' | 'MathJax' | 'none'

export enum UpgradeChannel {
  LATEST = 'latest', // 最新稳定版本
  RC = 'rc', // 公测版本
  BETA = 'beta' // 预览版本
}

export type ChatMessageStyle = 'plain' | 'bubble'

export type ChatMessageNavigationMode = 'none' | 'buttons' | 'anchor'

export type MultiModelMessageStyle = 'horizontal' | 'vertical' | 'fold' | 'grid'

export type MultiModelGridPopoverTrigger = 'hover' | 'click'

// ============================================================================
// WebSearch Types
// ============================================================================

/**
 * 完整的 WebSearch Provider 配置
 * 存储在 Preference 中，包含所有字段
 */
export interface WebSearchProvider {
  /** Unique provider identifier */
  id: string
  /** Display name */
  name: string
  /** Provider type: 'api' for API-based, 'local' for browser-based */
  type: 'api' | 'local'
  /** API key */
  apiKey: string
  /** API host */
  apiHost: string
  /** Search engines (for SearXNG) */
  engines: string[]
  /** Whether to use browser for search */
  usingBrowser: boolean
  /** Basic auth username */
  basicAuthUsername: string
  /** Basic auth password */
  basicAuthPassword: string
}

/**
 * 所有 Provider 的配置数组
 * 存储在 chat.websearch.providers 中
 */
export type WebSearchProviders = WebSearchProvider[]

// ============================================================================
// WebSearch Compression Types (v2 - Flattened)
// ============================================================================

/**
 * 压缩方式类型
 * 存储在 chat.websearch.compression.method 中
 */
export type WebSearchCompressionMethod = 'none' | 'cutoff' | 'rag'

/**
 * Cutoff 单位类型
 * 存储在 chat.websearch.compression.cutoff_unit 中
 */
export type WebSearchCompressionCutoffUnit = 'char' | 'token'
