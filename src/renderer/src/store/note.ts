import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { RootState } from '@renderer/store/index'

export interface NotesSettings {
  isFullWidth: boolean
  fontFamily: 'default' | 'serif'
  editorMode: 'editor' | 'source' | 'preview'
}

export interface NoteState {
  activeNodeId: string | undefined
  settings: NotesSettings
  folderPath: string | null
}

export const initialState: NoteState = {
  activeNodeId: undefined,
  settings: {
    isFullWidth: true,
    fontFamily: 'default',
    editorMode: 'editor'
  },
  folderPath: null
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
    setFolderPath: (state, action: PayloadAction<string | null>) => {
      state.folderPath = action.payload
    }
  }
})

export const { setActiveNodeId, updateNotesSettings, setFolderPath } = noteSlice.actions

export const selectActiveNodeId = (state: RootState) => state.note.activeNodeId
export const selectNotesSettings = (state: RootState) => state.note.settings
export const selectFolderPath = (state: RootState) => state.note.folderPath

export default noteSlice.reducer
