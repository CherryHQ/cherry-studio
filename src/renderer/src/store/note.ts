import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { RootState } from '@renderer/store/index'
import { EditorView } from '@renderer/types'
import { NotesSortType } from '@renderer/types/note'

export interface NotesSettings {
  isFullWidth: boolean
  fontFamily: 'default' | 'serif'
  fontSize: number
  showTableOfContents: boolean
  defaultViewMode: 'edit' | 'read'
  defaultEditMode: Omit<EditorView, 'read'>
  showTabStatus: boolean
  showWorkspace: boolean
}

export interface NoteState {
  activeNodeId: string | undefined
  activeFilePath: string | undefined // 使用文件路径而不是nodeId
  settings: NotesSettings
  notesPath: string
  sortType: NotesSortType
}

export const initialState: NoteState = {
  activeNodeId: undefined,
  activeFilePath: undefined,
  settings: {
    isFullWidth: true,
    fontFamily: 'default',
    fontSize: 16,
    showTableOfContents: true,
    defaultViewMode: 'edit',
    defaultEditMode: 'preview',
    showTabStatus: true,
    showWorkspace: true
  },
  notesPath: '',
  sortType: 'sort_a2z'
}

const noteSlice = createSlice({
  name: 'note',
  initialState,
  reducers: {
    setActiveNodeId: (state, action: PayloadAction<string | undefined>) => {
      state.activeNodeId = action.payload
    },
    setActiveFilePath: (state, action: PayloadAction<string | undefined>) => {
      state.activeFilePath = action.payload
    },
    updateNotesSettings: (state, action: PayloadAction<Partial<NotesSettings>>) => {
      state.settings = { ...state.settings, ...action.payload }
    },
    setNotesPath: (state, action: PayloadAction<string>) => {
      state.notesPath = action.payload
    },
    setSortType: (state, action: PayloadAction<NotesSortType>) => {
      state.sortType = action.payload
    }
  }
})

export const { setActiveNodeId, setActiveFilePath, updateNotesSettings, setNotesPath, setSortType } = noteSlice.actions

export const selectActiveNodeId = (state: RootState) => state.note.activeNodeId
export const selectActiveFilePath = (state: RootState) => state.note.activeFilePath
export const selectNotesSettings = (state: RootState) => state.note.settings
export const selectNotesPath = (state: RootState) => state.note.notesPath
export const selectSortType = (state: RootState) => state.note.sortType

export default noteSlice.reducer
