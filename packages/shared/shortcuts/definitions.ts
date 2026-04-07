import type { ShortcutDefinition } from './types'

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  // ==================== 应用级快捷键 ====================
  {
    key: 'shortcut.app.show_main_window',
    defaultKey: [],
    scope: 'main',
    category: 'app',
    system: true,
    persistOnBlur: true
  },
  {
    key: 'shortcut.app.show_mini_window',
    defaultKey: ['CommandOrControl', 'E'],
    scope: 'main',
    category: 'selection',
    system: true,
    persistOnBlur: true,
    enabledWhen: (getPreference) => !!getPreference('feature.quick_assistant.enabled')
  },
  {
    key: 'shortcut.app.show_settings',
    defaultKey: ['CommandOrControl', ','],
    scope: 'both',
    category: 'app',
    editable: false,
    system: true
  },
  {
    key: 'shortcut.app.toggle_show_assistants',
    defaultKey: ['CommandOrControl', '['],
    scope: 'renderer',
    category: 'app'
  },
  {
    key: 'shortcut.app.exit_fullscreen',
    defaultKey: ['Escape'],
    scope: 'renderer',
    category: 'app',
    editable: false,
    system: true
  },
  {
    key: 'shortcut.app.zoom_in',
    defaultKey: ['CommandOrControl', '='],
    scope: 'main',
    category: 'app',
    editable: false,
    system: true,
    variants: [['CommandOrControl', 'numadd']]
  },
  {
    key: 'shortcut.app.zoom_out',
    defaultKey: ['CommandOrControl', '-'],
    scope: 'main',
    category: 'app',
    editable: false,
    system: true,
    variants: [['CommandOrControl', 'numsub']]
  },
  {
    key: 'shortcut.app.zoom_reset',
    defaultKey: ['CommandOrControl', '0'],
    scope: 'main',
    category: 'app',
    editable: false,
    system: true
  },
  {
    key: 'shortcut.app.search_message',
    defaultKey: ['CommandOrControl', 'Shift', 'F'],
    scope: 'renderer',
    category: 'topic'
  },
  // ==================== 聊天相关快捷键 ====================
  {
    key: 'shortcut.chat.clear',
    defaultKey: ['CommandOrControl', 'L'],
    scope: 'renderer',
    category: 'chat'
  },
  {
    key: 'shortcut.chat.search_message',
    defaultKey: ['CommandOrControl', 'F'],
    scope: 'renderer',
    category: 'chat'
  },
  {
    key: 'shortcut.chat.toggle_new_context',
    defaultKey: ['CommandOrControl', 'K'],
    scope: 'renderer',
    category: 'chat'
  },
  {
    key: 'shortcut.chat.copy_last_message',
    defaultKey: ['CommandOrControl', 'Shift', 'C'],
    scope: 'renderer',
    category: 'chat'
  },
  {
    key: 'shortcut.chat.edit_last_user_message',
    defaultKey: ['CommandOrControl', 'Shift', 'E'],
    scope: 'renderer',
    category: 'chat'
  },
  {
    key: 'shortcut.chat.select_model',
    defaultKey: ['CommandOrControl', 'Shift', 'M'],
    scope: 'renderer',
    category: 'chat'
  },
  // ==================== 话题管理快捷键 ====================
  {
    key: 'shortcut.topic.new',
    defaultKey: ['CommandOrControl', 'N'],
    scope: 'renderer',
    category: 'topic'
  },
  {
    key: 'shortcut.topic.rename',
    defaultKey: ['CommandOrControl', 'T'],
    scope: 'renderer',
    category: 'topic'
  },
  {
    key: 'shortcut.topic.toggle_show_topics',
    defaultKey: ['CommandOrControl', ']'],
    scope: 'renderer',
    category: 'topic'
  },
  // ==================== 划词助手快捷键 ====================
  {
    key: 'shortcut.selection.toggle_enabled',
    defaultKey: [],
    scope: 'main',
    category: 'selection',
    system: true,
    persistOnBlur: true,
    supportedPlatforms: ['darwin', 'win32']
  },
  {
    key: 'shortcut.selection.get_text',
    defaultKey: [],
    scope: 'main',
    category: 'selection',
    system: true,
    persistOnBlur: true,
    supportedPlatforms: ['darwin', 'win32']
  }
] as const

export const findShortcutDefinition = (key: string): ShortcutDefinition | undefined => {
  return SHORTCUT_DEFINITIONS.find((definition) => definition.key === key)
}
