import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

export type ShortcutScope = 'main' | 'renderer' | 'both'

export type ShortcutCategory = 'app' | 'chat' | 'topic' | 'selection'

export type ShortcutPreferenceKey = Extract<PreferenceKeyType, `shortcut.${string}`>

export type ShortcutKey = ShortcutPreferenceKey extends `shortcut.${infer Rest}` ? Rest : never

export type GetPreferenceFn = <K extends PreferenceKeyType>(key: K) => PreferenceDefaultScopeType[K]

export type ShortcutEnabledPredicate = (getPreference: GetPreferenceFn) => boolean

export interface ShortcutDefinition {
  key: ShortcutPreferenceKey
  defaultKey: string[]
  scope: ShortcutScope
  category: ShortcutCategory
  editable?: boolean
  system?: boolean
  persistOnBlur?: boolean
  variants?: string[][]
  enabledWhen?: ShortcutEnabledPredicate
  supportedPlatforms?: NodeJS.Platform[]
}

export interface ShortcutPreferenceValue {
  binding: string[]
  rawBinding: string[]
  hasCustomBinding: boolean
  enabled: boolean
  editable: boolean
  system: boolean
}
