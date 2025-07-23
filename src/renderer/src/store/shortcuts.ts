import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Shortcut } from '@renderer/types'
import { ZOOM_SHORTCUTS } from '@shared/config/constant'

export interface ShortcutsState {
  shortcuts: Shortcut[]
}

const initialState: ShortcutsState = {
  shortcuts: [
    ...ZOOM_SHORTCUTS,
    {
      key: 'show_settings',
      shortcut: ['CommandOrControl', ','],
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
      shortcut: ['CommandOrControl', 'E'],
      editable: true,
      enabled: false,
      system: true
    },
    {
      key: 'pin_window',
      shortcut: ['CommandOrControl', 'P'],
      editable: true,
      enabled: true,
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
      shortcut: ['CommandOrControl', 'N'],
      editable: true,
      enabled: true,
      system: false
    },
    {
      key: 'toggle_show_assistants',
      shortcut: ['CommandOrControl', '['],
      editable: true,
      enabled: true,
      system: false
    },

    {
      key: 'toggle_show_topics',
      shortcut: ['CommandOrControl', ']'],
      editable: true,
      enabled: true,
      system: false
    },
    {
      key: 'copy_last_message',
      shortcut: ['CommandOrControl', 'Shift', 'C'],
      editable: true,
      enabled: false,
      system: false
    },
    {
      key: 'search_message_in_chat',
      shortcut: ['CommandOrControl', 'F'],
      editable: true,
      enabled: true,
      system: false
    },
    {
      key: 'search_message',
      shortcut: ['CommandOrControl', 'Shift', 'F'],
      editable: true,
      enabled: true,
      system: false
    },
    {
      key: 'clear_topic',
      shortcut: ['CommandOrControl', 'L'],
      editable: true,
      enabled: true,
      system: false
    },
    {
      key: 'toggle_new_context',
      shortcut: ['CommandOrControl', 'K'],
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

const shortcutsSlice = createSlice({
  name: 'shortcuts',
  initialState,
  reducers: {
    updateShortcut: (state, action: PayloadAction<Shortcut>) => {
      state.shortcuts = state.shortcuts.map((s) => (s.key === action.payload.key ? action.payload : s))
      window.api.shortcuts.update(getSerializableShortcuts(state.shortcuts))
    },
    toggleShortcut: (state, action: PayloadAction<string>) => {
      state.shortcuts = state.shortcuts.map((s) => (s.key === action.payload ? { ...s, enabled: !s.enabled } : s))
      window.api.shortcuts.update(getSerializableShortcuts(state.shortcuts))
    },
    resetShortcuts: (state) => {
      state.shortcuts = initialState.shortcuts
      window.api.shortcuts.update(getSerializableShortcuts(state.shortcuts))
    }
  }
})

export const { updateShortcut, toggleShortcut, resetShortcuts } = shortcutsSlice.actions
export default shortcutsSlice.reducer
export { initialState }
