import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

export type ShortcutScope = 'main' | 'renderer' | 'both'

export type ShortcutCategory = 'app' | 'chat' | 'topic' | 'selection'

/** Desktop platforms actually supported by Cherry Studio */
export type SupportedPlatform = Extract<NodeJS.Platform, 'darwin' | 'win32' | 'linux'>

export type ShortcutPreferenceKey = Extract<PreferenceKeyType, `shortcut.${string}`>

export type ShortcutKey = ShortcutPreferenceKey extends `shortcut.${infer Rest}` ? Rest : never

export type GetPreferenceFn = <K extends PreferenceKeyType>(key: K) => PreferenceDefaultScopeType[K]

export type ShortcutEnabledPredicate = (getPreference: GetPreferenceFn) => boolean

/** Static metadata for a single shortcut — the single source of truth for the shortcut system. */
export interface ShortcutDefinition {
  /** Preference key in `shortcut.{category}.{name}` format (e.g. `shortcut.chat.clear`). */
  key: ShortcutPreferenceKey
  /** Default key binding in Electron accelerator format (e.g. `['CommandOrControl', 'L']`). Empty array means no default binding. */
  defaultKey: string[]
  /** Where the shortcut is registered: `main` (globalShortcut), `renderer` (react-hotkeys-hook), or `both`. */
  scope: ShortcutScope
  /** Logical category for UI grouping in the settings page. */
  category: ShortcutCategory
  /** i18n label key used by `getShortcutLabel()` for display. */
  labelKey: string
  /** Whether users can modify the binding in settings. Defaults to `true`. */
  editable?: boolean
  /** System-level shortcut — when `true` the binding cannot be deleted. */
  system?: boolean
  /** Whether the shortcut stays registered when the window loses focus (i.e. a global shortcut). */
  persistOnBlur?: boolean
  /** Additional equivalent bindings for the same action (e.g. numpad variants for zoom). */
  variants?: string[][]
  /** Dynamic enable condition evaluated at registration time. Return `false` to skip registration. */
  enabledWhen?: ShortcutEnabledPredicate
  /** Restrict this shortcut to specific operating systems. Omit to enable on all platforms. */
  supportedPlatforms?: SupportedPlatform[]
}

/** Runtime-resolved shortcut state after merging user preferences with definition defaults. */
export interface ShortcutPreferenceValue {
  /** Effective key binding used at runtime. Always contains a valid binding (user-defined or default). */
  binding: string[]
  /** Whether this shortcut is currently enabled. */
  enabled: boolean
  /** Whether users can modify the binding. Injected from `ShortcutDefinition.editable`, not stored in preferences. */
  editable: boolean
  /** System-level flag. Injected from `ShortcutDefinition.system`, not stored in preferences. */
  system: boolean
}
