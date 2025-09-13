import { createSelector, createSlice, PayloadAction } from '@reduxjs/toolkit'
import { AppLogo, UserAvatar } from '@renderer/config/env'
import type { MinAppType, Topic, WebSearchStatus } from '@renderer/types'
import type { UpdateInfo } from 'builder-util-runtime'

import type { RootState } from '.'

export interface ChatState {
  isMultiSelectMode: boolean
  selectedMessageIds: string[]
  activeTopic: Topic | null
  /** topic ids that are currently being renamed */
  renamingTopics: string[]
  /** topic ids that are newly renamed */
  newlyRenamedTopics: string[]
  /** assistant ids that have active todo lists */
  activeTodoExecutors: string[]
}

export interface WebSearchState {
  activeSearches: Record<string, WebSearchStatus>
}

export interface UpdateState {
  info: UpdateInfo | null
  checking: boolean
  downloading: boolean
  downloaded: boolean
  downloadProgress: number
  available: boolean
}

export interface RuntimeState {
  avatar: string
  generating: boolean
  translating: boolean
  translateAbortKey?: string
  /** whether the minapp popup is shown */
  minappShow: boolean
  /** the minapps that are opened and should be keep alive */
  openedKeepAliveMinapps: MinAppType[]
  /** the minapp that is opened for one time */
  openedOneOffMinapp: MinAppType | null
  /** the current minapp id */
  currentMinappId: string
  searching: boolean
  filesPath: string
  resourcesPath: string
  update: UpdateState
  export: ExportState
  chat: ChatState
  websearch: WebSearchState
}

export interface ExportState {
  isExporting: boolean
}

const initialState: RuntimeState = {
  avatar: UserAvatar,
  generating: false,
  translating: false,
  minappShow: false,
  openedKeepAliveMinapps: [],
  openedOneOffMinapp: null,
  currentMinappId: '',
  searching: false,
  filesPath: '',
  resourcesPath: '',
  update: {
    info: null,
    checking: false,
    downloading: false,
    downloaded: false,
    downloadProgress: 0,
    available: false
  },
  export: {
    isExporting: false
  },
  chat: {
    isMultiSelectMode: false,
    selectedMessageIds: [],
    activeTopic: null,
    renamingTopics: [],
    newlyRenamedTopics: [],
    activeTodoExecutors: []
  },
  websearch: {
    activeSearches: {}
  }
}

const runtimeSlice = createSlice({
  name: 'runtime',
  initialState,
  reducers: {
    setAvatar: (state, action: PayloadAction<string | null>) => {
      state.avatar = action.payload || AppLogo
    },
    setGenerating: (state, action: PayloadAction<boolean>) => {
      state.generating = action.payload
    },
    setTranslating: (state, action: PayloadAction<boolean>) => {
      state.translating = action.payload
    },
    setTranslateAbortKey: (state, action: PayloadAction<string>) => {
      state.translateAbortKey = action.payload
    },
    setMinappShow: (state, action: PayloadAction<boolean>) => {
      state.minappShow = action.payload
    },
    setOpenedKeepAliveMinapps: (state, action: PayloadAction<MinAppType[]>) => {
      state.openedKeepAliveMinapps = action.payload
    },
    setOpenedOneOffMinapp: (state, action: PayloadAction<MinAppType | null>) => {
      state.openedOneOffMinapp = action.payload
    },
    setCurrentMinappId: (state, action: PayloadAction<string>) => {
      state.currentMinappId = action.payload
    },
    setSearching: (state, action: PayloadAction<boolean>) => {
      state.searching = action.payload
    },
    setFilesPath: (state, action: PayloadAction<string>) => {
      state.filesPath = action.payload
    },
    setResourcesPath: (state, action: PayloadAction<string>) => {
      state.resourcesPath = action.payload
    },
    setUpdateState: (state, action: PayloadAction<Partial<UpdateState>>) => {
      state.update = { ...state.update, ...action.payload }
    },
    setExportState: (state, action: PayloadAction<Partial<ExportState>>) => {
      state.export = { ...state.export, ...action.payload }
    },
    // Chat related actions
    toggleMultiSelectMode: (state, action: PayloadAction<boolean>) => {
      state.chat.isMultiSelectMode = action.payload
      if (!action.payload) {
        state.chat.selectedMessageIds = []
      }
    },
    setSelectedMessageIds: (state, action: PayloadAction<string[]>) => {
      state.chat.selectedMessageIds = action.payload
    },
    setActiveTopic: (state, action: PayloadAction<Topic>) => {
      state.chat.activeTopic = action.payload
    },
    setRenamingTopics: (state, action: PayloadAction<string[]>) => {
      state.chat.renamingTopics = action.payload
    },
    setNewlyRenamedTopics: (state, action: PayloadAction<string[]>) => {
      state.chat.newlyRenamedTopics = action.payload
    },
    setActiveTodoExecutors: (state, action: PayloadAction<string[]>) => {
      state.chat.activeTodoExecutors = action.payload
    },
    addActiveTodoExecutor: (state, action: PayloadAction<string>) => {
      const id = action.payload
      if (!state.chat.activeTodoExecutors.includes(id)) {
        state.chat.activeTodoExecutors.push(id)
      }
    },
    removeActiveTodoExecutor: (state, action: PayloadAction<string>) => {
      const id = action.payload
      state.chat.activeTodoExecutors = state.chat.activeTodoExecutors.filter((x) => x !== id)
    },
    // WebSearch related actions
    setActiveSearches: (state, action: PayloadAction<Record<string, WebSearchStatus>>) => {
      state.websearch.activeSearches = action.payload
    },
    setWebSearchStatus: (state, action: PayloadAction<{ requestId: string; status: WebSearchStatus }>) => {
      const { requestId, status } = action.payload
      if (status.phase === 'default') {
        delete state.websearch.activeSearches[requestId]
      }
      state.websearch.activeSearches[requestId] = status
    }
  }
})

export const {
  setAvatar,
  setGenerating,
  setTranslating,
  setTranslateAbortKey,
  setMinappShow,
  setOpenedKeepAliveMinapps,
  setOpenedOneOffMinapp,
  setCurrentMinappId,
  setSearching,
  setFilesPath,
  setResourcesPath,
  setUpdateState,
  setExportState,
  // Chat related actions
  toggleMultiSelectMode,
  setSelectedMessageIds,
  setActiveTopic,
  setRenamingTopics,
  setNewlyRenamedTopics,
  setActiveTodoExecutors,
  addActiveTodoExecutor,
  removeActiveTodoExecutor,
  // WebSearch related actions
  setActiveSearches,
  setWebSearchStatus
} = runtimeSlice.actions

export default runtimeSlice.reducer

// Selectors
export const selectActiveTodoExecutorIds = (state: RootState) => state.runtime.chat.activeTodoExecutors
export const selectActiveTodoExecutorSet = createSelector([selectActiveTodoExecutorIds], (ids) => new Set(ids))
