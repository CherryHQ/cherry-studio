import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

export type ShortcutScope = 'main' | 'renderer' | 'both'

/** Built-in shortcut categories for UI grouping. */
export type BuiltinShortcutCategory = 'app.general' | 'app.chat' | 'app.topic' | 'feature.selection'

/**
 * Dot-separated namespace for UI grouping in the settings page.
 * Built-in: `app.general`, `app.chat`, `app.topic`, `feature.selection`.
 * Plugins: `plugin.{pluginId}` (e.g. `plugin.translator`).
 */
export type ShortcutCategory = BuiltinShortcutCategory | `plugin.${string}`

/** Desktop platforms actually supported by Cherry Studio */
export type SupportedPlatform = Extract<NodeJS.Platform, 'darwin' | 'win32' | 'linux'>

export type ShortcutPreferenceKey = Extract<PreferenceKeyType, `shortcut.${string}`>

export type ShortcutKey = ShortcutPreferenceKey extends `shortcut.${infer Rest}` ? Rest : never

export type GetPreferenceFn = <K extends PreferenceKeyType>(key: K) => PreferenceDefaultScopeType[K]

export type ShortcutEnabledPredicate = (getPreference: GetPreferenceFn) => boolean

/** Static metadata for a single shortcut — the single source of truth for the shortcut system. */
export interface ShortcutDefinition {
  /** Preference key in `shortcut.app.{category}.{name}` format for built-in shortcuts. Plugins use `shortcut.plugin.{pluginId}.{name}`. */
  key: ShortcutPreferenceKey
  /** Default key binding in Electron accelerator format (e.g. `['CommandOrControl', 'L']`). Empty array means no default binding. */
  defaultBinding: string[]
  /** Where the shortcut is registered: `main` (globalShortcut), `renderer` (react-hotkeys-hook), or `both`. */
  scope: ShortcutScope
  /** Dot-separated category for UI grouping (e.g. `app.general`, `app.chat`, `app.topic`, `plugin.translator`). */
  category: ShortcutCategory
  /** i18n label key used by `getShortcutLabel()` for display. */
  labelKey: string
  /** Whether users can modify the binding in settings. Defaults to `true`. */
  editable?: boolean
  /** System-level shortcut — when `true` the binding cannot be deleted. */
  system?: boolean
  /** Global shortcut — stays registered when the window loses focus. Aligns with Electron `globalShortcut`. */
  global?: boolean
  /** Additional equivalent bindings for the same action (e.g. numpad variants for zoom). */
  variants?: string[][]
  /** Dynamic enable condition evaluated at registration time. Return `false` to skip registration. */
  enabledWhen?: ShortcutEnabledPredicate
  /** Restrict this shortcut to specific operating systems. Omit to enable on all platforms. */
  supportedPlatforms?: SupportedPlatform[]
}

/** Runtime-resolved shortcut state after merging user preferences with definition defaults. */
export interface ResolvedShortcut {
  /** Effective key binding used at runtime. User-defined, default, or empty (explicitly cleared). */
  binding: string[]
  /** Whether this shortcut is currently enabled. */
  enabled: boolean
  /** Whether users can modify the binding. Injected from `ShortcutDefinition.editable`, not stored in preferences. */
  editable: boolean
  /** System-level flag. Injected from `ShortcutDefinition.system`, not stored in preferences. */
  system: boolean
}
