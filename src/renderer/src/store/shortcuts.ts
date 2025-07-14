import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { isMac, isWin } from '@renderer/config/constant'
import { Shortcut } from '@renderer/types'
import { ZOOM_SHORTCUTS } from '@shared/config/constant'

export interface ShortcutsState {
  /** @deprecated use {@link selectShortcuts} instead */
  shortcuts?: Shortcut[]
  shortcuts_windows: Shortcut[]
  shortcuts_mac: Shortcut[]
  shortcuts_linux: Shortcut[]
}

const createDefaultShortcuts = (isMac = false) => [
  ...ZOOM_SHORTCUTS,
  {
    key: 'show_settings',
    shortcut: [isMac ? 'Command' : 'Ctrl', ','],
    editable: false,
    enabled: true,
    system: true
  },
  {
    key: 'show_app',
    shortcut: [],
    editable: true,
    enabled: true,
    system: true
  },
  {
    key: 'mini_window',
    shortcut: [isMac ? 'Command' : 'Ctrl', 'E'],
    editable: true,
    enabled: false,
    system: true
  },
  {
    //enable/disable selection assistant
    key: 'selection_assistant_toggle',
    shortcut: [],
    editable: true,
    enabled: false,
    system: true
  },
  {
    //to select text with selection assistant
    key: 'selection_assistant_select_text',
    shortcut: [],
    editable: true,
    enabled: false,
    system: true
  },
  {
    key: 'new_topic',
    shortcut: [isMac ? 'Command' : 'Ctrl', 'N'],
    editable: true,
    enabled: true,
    system: false
  },
  {
    key: 'toggle_show_assistants',
    shortcut: [isMac ? 'Command' : 'Ctrl', '['],
    editable: true,
    enabled: true,
    system: false
  },

  {
    key: 'toggle_show_topics',
    shortcut: [isMac ? 'Command' : 'Ctrl', ']'],
    editable: true,
    enabled: true,
    system: false
  },
  {
    key: 'copy_last_message',
    shortcut: [isMac ? 'Command' : 'Ctrl', 'Shift', 'C'],
    editable: true,
    enabled: false,
    system: false
  },
  {
    key: 'search_message_in_chat',
    shortcut: [isMac ? 'Command' : 'Ctrl', 'F'],
    editable: true,
    enabled: true,
    system: false
  },
  {
    key: 'search_message',
    shortcut: [isMac ? 'Command' : 'Ctrl', 'Shift', 'F'],
    editable: true,
    enabled: true,
    system: false
  },
  {
    key: 'clear_topic',
    shortcut: [isMac ? 'Command' : 'Ctrl', 'L'],
    editable: true,
    enabled: true,
    system: false
  },
  {
    key: 'toggle_new_context',
    shortcut: [isMac ? 'Command' : 'Ctrl', 'K'],
    editable: true,
    enabled: true,
    system: false
  },
  {
    key: 'exit_fullscreen',
    shortcut: ['Escape'],
    editable: false,
    enabled: true,
    system: true
  }
]

const initialState: ShortcutsState = {
  shortcuts: undefined,
  shortcuts_mac: createDefaultShortcuts(true),
  shortcuts_windows: createDefaultShortcuts(false),
  shortcuts_linux: createDefaultShortcuts(false)
}

const getSerializableShortcuts = (shortcuts: Shortcut[]) => {
  return shortcuts.map((shortcut) => ({
    key: shortcut.key,
    shortcut: [...shortcut.shortcut],
    enabled: shortcut.enabled,
    system: shortcut.system,
    editable: shortcut.editable
  }))
}

const getShortcuts = (state: ShortcutsState) =>
  isMac ? state.shortcuts_mac : isWin ? state.shortcuts_windows : state.shortcuts_linux

const setShortcuts = (state: ShortcutsState, shortcuts: Shortcut[]) => {
  isMac
    ? (state.shortcuts_mac = shortcuts)
    : isWin
      ? (state.shortcuts_windows = shortcuts)
      : (state.shortcuts_linux = shortcuts)
}

export const shortcutsSlice = createSlice({
  name: 'shortcuts',
  initialState,
  reducers: {
    updateShortcut: (state, action: PayloadAction<Shortcut>) => {
      const shortcuts = getShortcuts(state).map((s) => (s.key === action.payload.key ? action.payload : s))
      setShortcuts(state, shortcuts)
      window.api.shortcuts.update(getSerializableShortcuts(shortcuts))
    },
    toggleShortcut: (state, action: PayloadAction<string>) => {
      const shortcuts = getShortcuts(state).map((s) => (s.key === action.payload ? { ...s, enabled: !s.enabled } : s))
      setShortcuts(state, shortcuts)
      window.api.shortcuts.update(getSerializableShortcuts(shortcuts))
    },
    resetShortcuts: (state) => {
      const shortcuts = getShortcuts(initialState)
      setShortcuts(state, shortcuts)
      window.api.shortcuts.update(getSerializableShortcuts(shortcuts))
    }
  },
  selectors: {
    selectShortcuts: getShortcuts
  }
})

export const { updateShortcut, toggleShortcut, resetShortcuts } = shortcutsSlice.actions
export const { selectShortcuts } = shortcutsSlice.selectors
export default shortcutsSlice.reducer
export { initialState }
