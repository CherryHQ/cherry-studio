/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { RootState } from '@renderer/store/index'
import type { EditorView } from '@renderer/types'
import type { NotesSortType } from '@renderer/types/note'

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
  starredPaths: string[]
  expandedPaths: string[]
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
  sortType: 'sort_a2z',
  starredPaths: [],
  expandedPaths: []
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
    },
    setStarredPaths: (state, action: PayloadAction<string[]>) => {
      state.starredPaths = action.payload ?? []
    },
    setExpandedPaths: (state, action: PayloadAction<string[]>) => {
      state.expandedPaths = action.payload ?? []
    }
  }
})

export const {
  setActiveNodeId,
  setActiveFilePath,
  updateNotesSettings,
  setNotesPath,
  setSortType,
  setStarredPaths,
  setExpandedPaths
} = noteSlice.actions

export const selectActiveNodeId = (state: RootState) => state.note.activeNodeId
export const selectActiveFilePath = (state: RootState) => state.note.activeFilePath
export const selectNotesSettings = (state: RootState) => state.note.settings
export const selectNotesPath = (state: RootState) => state.note.notesPath
export const selectSortType = (state: RootState) => state.note.sortType
export const selectStarredPaths = (state: RootState) => state.note.starredPaths ?? []
export const selectExpandedPaths = (state: RootState) => state.note.expandedPaths ?? []

export default noteSlice.reducer
