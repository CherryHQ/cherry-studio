import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { AppLogo, UserAvatar } from '@renderer/config/env'
import type { UpdateInfo } from 'electron-updater'

export interface UpdateState {
  info: UpdateInfo | null
  checking: boolean
  downloading: boolean
  downloadProgress: number
  available: boolean
}

export interface WebDAVSyncState {
  syncing: boolean
  lastSyncTime?: number
  lastSyncError?: string | null
}

export interface GistSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface RuntimeState {
  avatar: string
  generating: boolean
  minappShow: boolean
  searching: boolean
  filesPath: string
  update: UpdateState
  webdavSync: WebDAVSyncState
  gistSync: GistSyncState
}

const initialState: RuntimeState = {
  avatar: UserAvatar,
  generating: false,
  minappShow: false,
  searching: false,
  filesPath: '',
  update: {
    info: null,
    checking: false,
    downloading: false,
    downloadProgress: 0,
    available: false
  },
  webdavSync: {
    syncing: false,
    lastSyncTime: undefined,
    lastSyncError: null
  },
  gistSync: {
    lastSyncTime: null,
    syncing: false,
    lastSyncError: null
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
    setMinappShow: (state, action: PayloadAction<boolean>) => {
      state.minappShow = action.payload
    },
    setSearching: (state, action: PayloadAction<boolean>) => {
      state.searching = action.payload
    },
    setFilesPath: (state, action: PayloadAction<string>) => {
      state.filesPath = action.payload
    },
    setUpdateState: (state, action: PayloadAction<Partial<UpdateState>>) => {
      state.update = { ...state.update, ...action.payload }
    },
    setWebDAVSyncState: (state, action: PayloadAction<Partial<WebDAVSyncState>>) => {
      state.webdavSync = { ...state.webdavSync, ...action.payload }
    },
    setGistSyncState: (state, action: PayloadAction<Partial<GistSyncState>>) => {
      state.gistSync = { ...state.gistSync, ...action.payload }
    }
  }
})

export const {
  setAvatar,
  setGenerating,
  setMinappShow,
  setSearching,
  setFilesPath,
  setUpdateState,
  setWebDAVSyncState,
  setGistSyncState
} = runtimeSlice.actions

export default runtimeSlice.reducer
