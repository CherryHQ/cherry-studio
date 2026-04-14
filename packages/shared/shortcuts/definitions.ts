import type { ShortcutDefinition, ShortcutPreferenceKey } from './types'

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  // ==================== Application shortcuts ====================
  {
    key: 'shortcut.general.show_main_window',
    scope: 'main',
    category: 'general',
    labelKey: 'show_app',
    global: true
  },
  {
    key: 'shortcut.general.show_settings',
    scope: 'main',
    category: 'general',
    labelKey: 'show_settings',
    editable: false
  },
  {
    key: 'shortcut.general.toggle_sidebar',
    scope: 'renderer',
    category: 'general',
    labelKey: 'toggle_sidebar'
  },
  {
    key: 'shortcut.general.exit_fullscreen',
    scope: 'renderer',
    category: 'general',
    labelKey: 'exit_fullscreen',
    editable: false
  },
  {
    key: 'shortcut.general.zoom_in',
    scope: 'main',
    category: 'general',
    labelKey: 'zoom_in',
    editable: false,
    variants: [['CommandOrControl', 'numadd']]
  },
  {
    key: 'shortcut.general.zoom_out',
    scope: 'main',
    category: 'general',
    labelKey: 'zoom_out',
    editable: false,
    variants: [['CommandOrControl', 'numsub']]
  },
  {
    key: 'shortcut.general.zoom_reset',
    scope: 'main',
    category: 'general',
    labelKey: 'zoom_reset',
    editable: false
  },
  {
    key: 'shortcut.general.search',
    scope: 'renderer',
    category: 'general',
    labelKey: 'search_message'
  },
  // ==================== Chat shortcuts ====================
  {
    key: 'shortcut.chat.clear',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'clear_topic'
  },
  {
    key: 'shortcut.chat.search_message',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'search_message_in_chat'
  },
  {
    key: 'shortcut.chat.toggle_new_context',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'toggle_new_context'
  },
  {
    key: 'shortcut.chat.copy_last_message',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'copy_last_message'
  },
  {
    key: 'shortcut.chat.edit_last_user_message',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'edit_last_user_message'
  },
  {
    key: 'shortcut.chat.select_model',
    scope: 'renderer',
    category: 'chat',
    labelKey: 'select_model'
  },
  // ==================== Topic shortcuts ====================
  {
    key: 'shortcut.topic.new',
    scope: 'renderer',
    category: 'topic',
    labelKey: 'new_topic'
  },
  {
    key: 'shortcut.topic.rename',
    scope: 'renderer',
    category: 'topic',
    labelKey: 'rename_topic'
  },
  {
    key: 'shortcut.topic.toggle_show_topics',
    scope: 'renderer',
    category: 'topic',
    labelKey: 'toggle_show_topics'
  },
  // ==================== Feature shortcuts ====================
  {
    key: 'shortcut.feature.quick_assistant.toggle_window',
    scope: 'main',
    category: 'feature.quick_assistant',
    labelKey: 'mini_window',
    global: true
  },
  {
    key: 'shortcut.feature.selection.toggle_enabled',
    scope: 'main',
    category: 'feature.selection',
    labelKey: 'selection_assistant_toggle',
    global: true,
    supportedPlatforms: ['darwin', 'win32']
  },
  {
    key: 'shortcut.feature.selection.get_text',
    scope: 'main',
    category: 'feature.selection',
    labelKey: 'selection_assistant_select_text',
    global: true,
    supportedPlatforms: ['darwin', 'win32']
  }
] as const

const definitionMap = new Map<ShortcutPreferenceKey, ShortcutDefinition>(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.key, definition])
)

export const findShortcutDefinition = (key: ShortcutPreferenceKey): ShortcutDefinition | undefined => {
  return definitionMap.get(key)
}
