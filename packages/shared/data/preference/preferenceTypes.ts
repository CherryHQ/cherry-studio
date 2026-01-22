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

// ============================================
// File Processing Types
// ============================================

/**
 * Processor-specific configuration
 *
 * Uses a generic Record type without predefined structure.
 * Each processor's configuration is interpreted by UI components based on processor.id.
 *
 * Known options fields:
 * - Tesseract: { langs: string[] }  // Array of enabled language codes
 *
 * Examples:
 * - { langs: ['chi_sim', 'eng'] }        // Tesseract language config
 * - { quality: 'high', timeout: 30000 }  // Other processor config
 */
export type FileProcessorOptions = Record<string, unknown>

/**
 * Feature-level user configuration
 *
 * Allows per-feature API host and model overrides.
 * This is needed because some processors (e.g., PaddleOCR) have different
 * API endpoints for different features.
 */
export type FeatureUserConfig = {
  feature: 'text_extraction' | 'to_markdown'
  apiHost?: string // User override for this feature's API Host
  modelId?: string // User override for this feature's Model ID
}

/**
 * User-configured processor data (stored in Preference)
 *
 * Design principles:
 * - Only stores user-modified fields
 * - id is required to match template
 * - apiKey is shared across all features (processor-level)
 * - apiHost/modelId are per-feature (in featureConfigs)
 * - Field names use camelCase (consistent with TypeScript conventions)
 */
export type FileProcessorUserConfig = {
  id: string // Processor ID, used to match template
  apiKey?: string // API Key (shared across all features)
  featureConfigs?: FeatureUserConfig[] // Feature-level configurations
  options?: FileProcessorOptions // Processor-specific config (generic type)
}
