import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import type { BrowserWindow } from 'electron'

export type ShortcutScope = 'main' | 'renderer' | 'both'

export type ShortcutCategory = 'app' | 'chat' | 'topic' | 'selection'

export type ShortcutPreferenceKey = Extract<PreferenceKeyType, `shortcut.${string}`>

export type GetPreferenceFn = <K extends PreferenceKeyType>(key: K) => PreferenceDefaultScopeType[K]

export type ShortcutEnabledPredicate = (getPreference: GetPreferenceFn) => boolean

export interface ShortcutDefinition {
  key: ShortcutPreferenceKey
  defaultKey: string[]
  scope: ShortcutScope
  category: ShortcutCategory
  persistOnBlur?: boolean
  variants?: string[][]
  enabledWhen?: ShortcutEnabledPredicate
}

export interface ShortcutPreferenceValue {
  binding: string[]
  rawBinding: string[]
  hasCustomBinding: boolean
  enabled: boolean
  editable: boolean
  system: boolean
}

export interface ShortcutRuntimeConfig extends ShortcutDefinition {
  binding: string[]
  enabled: boolean
  editable: boolean
  system: boolean
}

export type ShortcutHandler = (window?: BrowserWindow) => void | Promise<void>
