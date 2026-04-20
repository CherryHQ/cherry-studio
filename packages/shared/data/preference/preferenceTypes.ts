import type { BootConfigPreferenceKeys } from '@shared/data/bootConfig/bootConfigTypes'

import type { PreferenceSchemas } from './preferenceSchemas'

/** DB-backed preferences only (stored in SQLite) */
export type PreferenceDefaultScopeType = PreferenceSchemas['default']
export type PreferenceKeyType = keyof PreferenceDefaultScopeType

/** Unified type: DB-backed preferences + file-backed boot config (BootConfig.* prefix) */
export type UnifiedPreferenceType = PreferenceDefaultScopeType & BootConfigPreferenceKeys
export type UnifiedPreferenceKeyType = keyof UnifiedPreferenceType

/**
 * Result type for getMultipleRaw - maps requested keys to their values
 */
export type UnifiedPreferenceMultipleResultType<K extends UnifiedPreferenceKeyType> = {
  [P in K]: UnifiedPreferenceType[P]
}

export type PreferenceUpdateOptions = {
  optimistic: boolean
}

export type PreferenceShortcutType = {
  binding: string[]
  enabled: boolean
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
  | 'vi-VN'

export type WindowStyle = 'transparent' | 'opaque'

export type SendMessageShortcut = 'Enter' | 'Shift+Enter' | 'Ctrl+Enter' | 'Command+Enter' | 'Alt+Enter'

export type AssistantTabSortType = 'tags' | 'list'

export type SidebarIcon =
  | 'assistants'
  | 'agents'
  | 'store'
  | 'paintings'
  | 'translate'
  | 'minapp'
  | 'knowledge'
  | 'files'
  | 'code_tools'
  | 'notes'
  | 'openclaw'

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
// Translate Types
// ============================================================================

export type AutoDetectionMethod = 'franc' | 'llm' | 'auto'

// 为了支持自定义语言，设置为string别名
/** zh-cn, en-us, etc. */
export type TranslateLanguageCode = string
export type TranslateSourceLanguage = TranslateLanguageCode | 'auto'
export type TranslateBidirectionalPair = [TranslateLanguageCode, TranslateLanguageCode]

// ============================================================================
// WebSearch Types
// ============================================================================

export const WEB_SEARCH_PROVIDER_TYPES = ['api', 'mcp'] as const

export type WebSearchProviderType = (typeof WEB_SEARCH_PROVIDER_TYPES)[number]

export const WEB_SEARCH_PROVIDER_IDS = ['zhipu', 'tavily', 'searxng', 'exa', 'exa-mcp', 'bocha', 'querit'] as const

export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDER_IDS)[number]

export type WebSearchProviderOverride = {
  apiKeys?: string[]
  apiHost?: string
  engines?: string[]
  basicAuthUsername?: string
  basicAuthPassword?: string
}

export type WebSearchProviderOverrides = Partial<Record<WebSearchProviderId, WebSearchProviderOverride>>

export type WebSearchSubscribeSource = {
  key: number
  url: string
  name: string
  blacklist?: string[]
}

/**
 * Full WebSearch Provider configuration
 * Generated at runtime by merging preset with user overrides
 */
export interface WebSearchProvider {
  /** Unique provider identifier */
  id: WebSearchProviderId
  /** Display name (from preset) */
  name: string
  /** Provider type (from preset) */
  type: WebSearchProviderType
  /** API keys (from user overrides) */
  apiKeys: string[]
  /** API host (user override or preset default) */
  apiHost: string
  /** Search engines (from user overrides) */
  engines: string[]
  /** Basic auth username (from user overrides) */
  basicAuthUsername: string
  /** Basic auth password (from user overrides) */
  basicAuthPassword: string
}

// ============================================================================
// CodeCLI Types
// ============================================================================

import { codeCLI } from '@shared/config/constant'

export const CODE_CLI_IDS = Object.values(codeCLI) as unknown as readonly [
  'qwen-code',
  'claude-code',
  'gemini-cli',
  'openai-codex',
  'iflow-cli',
  'github-copilot-cli',
  'kimi-cli',
  'opencode'
]

export type CodeCliId = (typeof CODE_CLI_IDS)[number]

export type CodeCliOverride = {
  enabled?: boolean
  modelId?: string | null
  envVars?: string
  /** Terminal app name — should match `terminalApps` enum values */
  terminal?: string
  currentDirectory?: string
  directories?: string[]
}

export type CodeCliOverrides = Partial<Record<CodeCliId, CodeCliOverride>>

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

// ============================================================================
// File Processor Types
// ============================================================================

export const FILE_PROCESSOR_TYPES = ['api', 'builtin'] as const

export type FileProcessorType = (typeof FILE_PROCESSOR_TYPES)[number]

export const FILE_PROCESSOR_FEATURES = ['text_extraction', 'markdown_conversion'] as const

export type FileProcessorFeature = (typeof FILE_PROCESSOR_FEATURES)[number]

export const FILE_PROCESSOR_IDS = [
  'tesseract',
  'system',
  'paddleocr',
  'ovocr',
  'mineru',
  'doc2x',
  'mistral',
  'open-mineru'
] as const

export type FileProcessorId = (typeof FILE_PROCESSOR_IDS)[number]

export type FileProcessorOptions = Record<string, unknown>

export type FileProcessorCapabilityOverride = {
  apiHost?: string
  modelId?: string
}

export type FileProcessorCapabilityOverrides = Partial<Record<FileProcessorFeature, FileProcessorCapabilityOverride>>

export type FileProcessorOverride = {
  apiKeys?: string[]
  capabilities?: FileProcessorCapabilityOverrides
  options?: FileProcessorOptions
}

export type FileProcessorOverrides = Partial<Record<FileProcessorId, FileProcessorOverride>>
