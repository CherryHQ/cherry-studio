import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { RootState } from '@renderer/store/index'
import { EditorView } from '@renderer/types'

export interface NotesSettings {
  isFullWidth: boolean
  fontFamily: 'default' | 'serif'
  defaultViewMode: 'edit' | 'read'
  defaultEditMode: Omit<EditorView, 'read'>
  showTabStatus: boolean
}

export interface NoteState {
  activeNodeId: string | undefined
  settings: NotesSettings
  notesPath: string
}

export const initialState: NoteState = {
  activeNodeId: undefined,
  settings: {
    isFullWidth: true,
    fontFamily: 'default',
    defaultViewMode: 'edit',
    defaultEditMode: 'realtime',
    showTabStatus: true
  },
  notesPath: ''
}

const noteSlice = createSlice({
  name: 'note',
  initialState,
  reducers: {
    setActiveNodeId: (state, action: PayloadAction<string | undefined>) => {
      state.activeNodeId = action.payload
    },
    updateNotesSettings: (state, action: PayloadAction<Partial<NotesSettings>>) => {
      state.settings = { ...state.settings, ...action.payload }
    },
    setNotesPath: (state, action: PayloadAction<string>) => {
      state.notesPath = action.payload
    }
  }
})

export const { setActiveNodeId, updateNotesSettings, setNotesPath } = noteSlice.actions

export const selectActiveNodeId = (state: RootState) => state.note.activeNodeId
export const selectNotesSettings = (state: RootState) => state.note.settings
export const selectNotesPath = (state: RootState) => state.note.notesPath

export default noteSlice.reducer
