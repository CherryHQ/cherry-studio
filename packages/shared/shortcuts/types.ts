import type { PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

export type ShortcutScope = 'main' | 'renderer' | 'both'

/** Built-in shortcut categories for UI grouping. */
export type BuiltinShortcutCategory = 'general' | 'chat' | 'topic' | 'feature.quick_assistant' | 'feature.selection'

/**
 * Dot-separated namespace for UI grouping in the settings page.
 * Built-in: `general`, `chat`, `topic`, `feature.quick_assistant`, `feature.selection`.
 * Plugins: `plugin.{pluginId}` (e.g. `plugin.translator`).
 */
export type ShortcutCategory = BuiltinShortcutCategory | `plugin.${string}`

/** Desktop platforms actually supported by Cherry Studio */
export type SupportedPlatform = Extract<NodeJS.Platform, 'darwin' | 'win32' | 'linux'>

export type ShortcutPreferenceKey = Extract<PreferenceKeyType, `shortcut.${string}`>
export type ShortcutDependencyPreferenceKey = Extract<PreferenceKeyType, `feature.${string}.enabled`>

export type ShortcutKey = ShortcutPreferenceKey extends `shortcut.${infer Rest}` ? Rest : never

/** Static metadata for a single shortcut — the single source of truth for the shortcut system. */
export interface ShortcutDefinition {
  /** Preference key in `shortcut.{category}.{name}` format for built-in shortcuts. Plugins use `shortcut.plugin.{pluginId}.{name}`. */
  key: ShortcutPreferenceKey
  /** Where the shortcut is registered: `main` (globalShortcut), `renderer` (react-hotkeys-hook), or `both`. */
  scope: ShortcutScope
  /** Dot-separated category for UI grouping (e.g. `general`, `chat`, `topic`, `plugin.translator`). */
  category: ShortcutCategory
  /** i18n label key used by `getShortcutLabel()` for display. */
  labelKey: string
  /** Whether users can modify the binding in settings. Defaults to `true`. */
  editable?: boolean
  /** Global shortcut — stays registered when the window loses focus. Aligns with Electron `globalShortcut`. */
  global?: boolean
  /** Additional equivalent bindings for the same action (e.g. numpad variants for zoom). */
  variants?: string[][]
  /** Restrict this shortcut to specific operating systems. Omit to enable on all platforms. */
  supportedPlatforms?: SupportedPlatform[]
  /** Optional feature toggle that must be enabled before this shortcut can be shown or registered. */
  enabledWhen?: ShortcutDependencyPreferenceKey
}

/** Runtime-resolved shortcut state after merging user preferences with definition defaults. */
export interface ResolvedShortcut {
  /** Effective key binding used at runtime. User-defined, default, or empty (explicitly cleared). */
  binding: string[]
  /** Whether this shortcut is currently enabled. */
  enabled: boolean
}
