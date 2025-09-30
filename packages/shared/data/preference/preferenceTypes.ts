import type { PreferenceSchemas } from './preferenceSchemas'

export type PreferenceDefaultScopeType = PreferenceSchemas['default']
export type PreferenceKeyType = keyof PreferenceDefaultScopeType

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
export type LanguageVarious = 'zh-CN' | 'zh-TW' | 'el-GR' | 'en-US' | 'es-ES' | 'fr-FR' | 'ja-JP' | 'pt-PT' | 'ru-RU'

export type WindowStyle = 'transparent' | 'opaque'

export type SendMessageShortcut = 'Enter' | 'Shift+Enter' | 'Ctrl+Enter' | 'Command+Enter' | 'Alt+Enter'

export type AssistantTabSortType = 'tags' | 'list'

export type SidebarIcon =
  | 'assistants'
  | 'agents'
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
