import type { ShortcutDefinition, ShortcutPreferenceKey } from './types'

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  // ==================== 应用级快捷键 ====================
  {
    key: 'shortcut.general.show_main_window',
    defaultBinding: [],
    scope: 'main',
    category: 'general',
    labelKey: 'show_app',
    global: true
  },
  {
    key: 'shortcut.general.show_mini_window',
    defaultBinding: ['CommandOrControl', 'E'],
    scope: 'main',
    category: 'general',
    labelKey: 'mini_window',
    global: true
  },
  {
    key: 'shortcut.general.show_settings',
    defaultBinding: ['CommandOrControl', ','],
    scope: 'both',
    category: 'general',
    labelKey: 'show_settings',
    editable: false
  },
  {
    key: 'shortcut.general.toggle_sidebar',
    defaultBinding: ['CommandOrControl', '['],
    scope: 'renderer',
    category: 'general',
    labelKey: 'toggle_sidebar'
  },
  {
    key: 'shortcut.general.exit_fullscreen',
    defaultBinding: ['Escape'],
    scope: 'renderer',
    category: 'general',
    labelKey: 'exit_fullscreen',
    editable: false
  },
  {
    key: 'shortcut.general.zoom_in',
    defaultBinding: ['CommandOrControl', '='],
    scope: 'main',
    category: 'general',
    labelKey: 'zoom_in',
    editable: false,
    variants: [['CommandOrControl', 'numadd']]
  },
  {
    key: 'shortcut.general.zoom_out',
    defaultBinding: ['CommandOrControl', '-'],
    scope: 'main',
    category: 'general',
    labelKey: 'zoom_out',
    editable: false,
    variants: [['CommandOrControl', 'numsub']]
  },
  {
    key: 'shortcut.general.zoom_reset',
    defaultBinding: ['CommandOrControl', '0'],
    scope: 'main',
    category: 'general',
    labelKey: 'zoom_reset',
    editable: false
  },
  {
    key: 'shortcut.general.search',
    defaultBinding: ['CommandOrControl', 'Shift', 'F'],
    scope: 'renderer',
    category: 'general',
    labelKey: 'search_message'
  },
  // ==================== 聊天相关快捷键 ====================
  {
    key: 'shortcut.chat.clear',
    defaultBinding: ['CommandOrControl', 'L'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'clear_topic'
  },
  {
    key: 'shortcut.chat.search_message',
    defaultBinding: ['CommandOrControl', 'F'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'search_message_in_chat'
  },
  {
    key: 'shortcut.chat.toggle_new_context',
    defaultBinding: ['CommandOrControl', 'K'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'toggle_new_context'
  },
  {
    key: 'shortcut.chat.copy_last_message',
    defaultBinding: ['CommandOrControl', 'Shift', 'C'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'copy_last_message'
  },
  {
    key: 'shortcut.chat.edit_last_user_message',
    defaultBinding: ['CommandOrControl', 'Shift', 'E'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'edit_last_user_message'
  },
  {
    key: 'shortcut.chat.select_model',
    defaultBinding: ['CommandOrControl', 'Shift', 'M'],
    scope: 'renderer',
    category: 'chat',
    labelKey: 'select_model'
  },
  // ==================== 话题管理快捷键 ====================
  {
    key: 'shortcut.topic.new',
    defaultBinding: ['CommandOrControl', 'N'],
    scope: 'renderer',
    category: 'topic',
    labelKey: 'new_topic'
  },
  {
    key: 'shortcut.topic.rename',
    defaultBinding: ['CommandOrControl', 'T'],
    scope: 'renderer',
    category: 'topic',
    labelKey: 'rename_topic'
  },
  {
    key: 'shortcut.topic.toggle_show_topics',
    defaultBinding: ['CommandOrControl', ']'],
    scope: 'renderer',
    category: 'topic',
    labelKey: 'toggle_show_topics'
  },
  // ==================== 划词助手快捷键 ====================
  {
    key: 'shortcut.feature.selection.toggle_enabled',
    defaultBinding: [],
    scope: 'main',
    category: 'feature.selection',
    labelKey: 'selection_assistant_toggle',
    global: true,
    supportedPlatforms: ['darwin', 'win32']
  },
  {
    key: 'shortcut.feature.selection.get_text',
    defaultBinding: [],
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
