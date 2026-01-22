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
 * Provider type classification
 */
export type WebSearchProviderType = 'api' | 'local' | 'mcp'

/**
 * User configuration type (sparse object)
 * Stored in Preference chat.web_search.providers
 * Only contains fields that user has actually modified
 */
export interface WebSearchProviderUserConfig {
  /** Provider ID, required for matching with template */
  id: string
  /** User's API key */
  apiKey?: string
  /** User's custom API host (overrides template default) */
  apiHost?: string
  /** Search engines (for SearXNG) */
  engines?: string[]
  /** Basic auth username */
  basicAuthUsername?: string
  /** Basic auth password */
  basicAuthPassword?: string
}

/**
 * User configuration array
 * Stored in chat.web_search.providers
 */
export type WebSearchProviderUserConfigs = WebSearchProviderUserConfig[]

/**
 * Full WebSearch Provider configuration
 * Generated at runtime by merging template with user config
 */
export interface WebSearchProvider {
  /** Unique provider identifier */
  id: string
  /** Display name (from template) */
  name: string
  /** Provider type (from template) */
  type: WebSearchProviderType
  /** API key (from user config) */
  apiKey: string
  /** API host (user override or template default) */
  apiHost: string
  /** Search engines (from user config) */
  engines: string[]
  /** Whether to use browser for search (from template) */
  usingBrowser: boolean
  /** Basic auth username (from user config) */
  basicAuthUsername: string
  /** Basic auth password (from user config) */
  basicAuthPassword: string
}

// ============================================================================
// WebSearch Compression Types (v2 - Flattened)
// ============================================================================

/**
 * Compression method type
 * Stored in chat.web_search.compression.method
 */
export type WebSearchCompressionMethod = 'none' | 'cutoff' | 'rag'

/**
 * Cutoff unit type
 * Stored in chat.web_search.compression.cutoff_unit
 */
export type WebSearchCompressionCutoffUnit = 'char' | 'token'
