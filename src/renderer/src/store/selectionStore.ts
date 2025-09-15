/**
 * @deprecated The whole file will be removed after data refactoring
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { SelectionFilterMode, SelectionTriggerMode } from '@shared/data/preference/preferenceTypes'

export interface SelectionState {
  selectionEnabled: boolean
  triggerMode: SelectionTriggerMode
  isCompact: boolean
  isAutoClose: boolean
  isAutoPin: boolean
  isFollowToolbar: boolean
  isRemeberWinSize: boolean
  filterMode: SelectionFilterMode
  filterList: string[]
  actionWindowOpacity: number
  actionItems: SelectionActionItem[]
}

export const defaultActionItems: SelectionActionItem[] = [
  { id: 'translate', name: 'selection.action.builtin.translate', enabled: true, isBuiltIn: true, icon: 'languages' },
  { id: 'explain', name: 'selection.action.builtin.explain', enabled: true, isBuiltIn: true, icon: 'file-question' },
  { id: 'summary', name: 'selection.action.builtin.summary', enabled: true, isBuiltIn: true, icon: 'scan-text' },
  {
    id: 'search',
    name: 'selection.action.builtin.search',
    enabled: true,
    isBuiltIn: true,
    icon: 'search',
    searchEngine: 'Google|https://www.google.com/search?q={{queryString}}'
  },
  { id: 'copy', name: 'selection.action.builtin.copy', enabled: true, isBuiltIn: true, icon: 'clipboard-copy' },
  { id: 'refine', name: 'selection.action.builtin.refine', enabled: false, isBuiltIn: true, icon: 'wand-sparkles' },
  { id: 'quote', name: 'selection.action.builtin.quote', enabled: false, isBuiltIn: true, icon: 'quote' }
]

export const initialState: SelectionState = {
  selectionEnabled: false,
  triggerMode: SelectionTriggerMode.Selected,
  isCompact: false,
  isAutoClose: false,
  isAutoPin: false,
  isFollowToolbar: true,
  isRemeberWinSize: false,
  filterMode: SelectionFilterMode.Default,
  filterList: [],
  actionWindowOpacity: 100,
  actionItems: defaultActionItems
}

const selectionSlice = createSlice({
  name: 'selectionStore',
  initialState,
  reducers: {
    setSelectionEnabled: (state, action: PayloadAction<boolean>) => {
      state.selectionEnabled = action.payload
    },
    setTriggerMode: (state, action: PayloadAction<SelectionTriggerMode>) => {
      state.triggerMode = action.payload
    },
    setIsCompact: (state, action: PayloadAction<boolean>) => {
      state.isCompact = action.payload
    },
    setIsAutoClose: (state, action: PayloadAction<boolean>) => {
      state.isAutoClose = action.payload
    },
    setIsAutoPin: (state, action: PayloadAction<boolean>) => {
      state.isAutoPin = action.payload
    },
    setIsFollowToolbar: (state, action: PayloadAction<boolean>) => {
      state.isFollowToolbar = action.payload
    },
    setIsRemeberWinSize: (state, action: PayloadAction<boolean>) => {
      state.isRemeberWinSize = action.payload
    },
    setFilterMode: (state, action: PayloadAction<SelectionFilterMode>) => {
      state.filterMode = action.payload
    },
    setFilterList: (state, action: PayloadAction<string[]>) => {
      state.filterList = action.payload
    },
    setActionWindowOpacity: (state, action: PayloadAction<number>) => {
      state.actionWindowOpacity = action.payload
    },
    setActionItems: (state, action: PayloadAction<SelectionActionItem[]>) => {
      state.actionItems = action.payload
    }
  }
})

export const {
  setSelectionEnabled,
  setTriggerMode,
  setIsCompact,
  setIsAutoClose,
  setIsAutoPin,
  setIsFollowToolbar,
  setIsRemeberWinSize,
  setFilterMode,
  setFilterList,
  setActionWindowOpacity,
  setActionItems
} = selectionSlice.actions

export default selectionSlice.reducer
