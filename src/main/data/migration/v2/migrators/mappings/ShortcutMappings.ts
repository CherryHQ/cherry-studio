/**
 * Shortcut preference migration
 *
 * Legacy Redux stores shortcuts as an array of objects:
 *   { key: 'show_app', shortcut: ['CommandOrControl', 'S'], enabled: true, editable, system }
 *
 * The new preference schema stores each shortcut under its own key with shape:
 *   { binding: string[], enabled: boolean }
 *
 * Because the source is an array (not a keyed object), the simple mapping layer
 * cannot read it via `reduxState.get('shortcuts', 'show_app')`. This complex
 * mapping reads the entire `shortcuts` category, walks the array, and emits one
 * entry per known shortcut.
 */

import { loggerService } from '@logger'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { normalizeShortcutBinding } from '@shared/utils/shortcut'

import type { TransformFunction } from './ComplexPreferenceMappings'

const logger = loggerService.withContext('Migration:ShortcutMappings')

/**
 * Maps the legacy Redux shortcut `key` field to the new preference target key.
 */
export const LEGACY_KEY_TO_TARGET_KEY: Record<string, string> = {
  zoom_in: 'shortcut.app.zoom.in',
  zoom_out: 'shortcut.app.zoom.out',
  zoom_reset: 'shortcut.app.zoom.reset',
  show_settings: 'shortcut.app.settings.open',
  show_app: 'shortcut.app.window.show',
  new_topic: 'shortcut.topic.create',
  rename_topic: 'shortcut.topic.rename',
  toggle_show_topics: 'shortcut.topic.sidebar.toggle',
  toggle_show_assistants: 'shortcut.app.sidebar.toggle',
  toggle_sidebar: 'shortcut.app.sidebar.toggle',
  copy_last_message: 'shortcut.chat.message.copy_last',
  edit_last_user_message: 'shortcut.chat.message.edit_last_user',
  search_message_in_chat: 'shortcut.chat.message.search',
  search_message: 'shortcut.app.search',
  select_model: 'shortcut.chat.model.select',
  exit_fullscreen: 'shortcut.app.fullscreen.exit',
  mini_window: 'shortcut.quick_assistant.toggle',
  selection_assistant_toggle: 'shortcut.selection.toggle',
  selection_assistant_select_text: 'shortcut.selection.capture_text'
}

export const SHORTCUT_TARGET_KEYS: readonly string[] = [...new Set(Object.values(LEGACY_KEY_TO_TARGET_KEY))]

interface LegacyShortcutEntry {
  key?: unknown
  shortcut?: unknown
  enabled?: unknown
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const LEGACY_KEY_PRIORITY: Record<string, number> = {
  toggle_show_assistants: 0,
  toggle_sidebar: 1
}

export const transformShortcuts: TransformFunction = (sources) => {
  const shortcuts = sources.shortcuts
  const result: Record<string, PreferenceShortcutType> = {}
  const priorities = new Map<string, number>()

  if (!Array.isArray(shortcuts)) {
    if (shortcuts !== undefined) {
      logger.warn('Legacy shortcuts source is not an array; skipping migration', {
        type: typeof shortcuts
      })
    }
    return result
  }

  for (const entry of shortcuts as LegacyShortcutEntry[]) {
    if (!entry || typeof entry !== 'object') continue
    const legacyKey = typeof entry.key === 'string' ? entry.key : undefined
    if (!legacyKey) continue

    const targetKey = LEGACY_KEY_TO_TARGET_KEY[legacyKey]
    if (!targetKey) {
      logger.debug(`Skipping unknown legacy shortcut key: ${legacyKey}`)
      continue
    }

    if (entry.shortcut !== undefined && !isStringArray(entry.shortcut)) {
      logger.warn(`Skipping malformed legacy shortcut binding for key: ${legacyKey}`)
      continue
    }

    const currentPriority = LEGACY_KEY_PRIORITY[legacyKey] ?? 0
    const existingPriority = priorities.get(targetKey) ?? -1
    if (currentPriority < existingPriority) {
      continue
    }

    const binding = normalizeShortcutBinding(isStringArray(entry.shortcut) ? entry.shortcut : [])
    const enabled = typeof entry.enabled === 'boolean' ? entry.enabled : true

    result[targetKey] = { binding, enabled }
    priorities.set(targetKey, currentPriority)
  }

  return result
}
