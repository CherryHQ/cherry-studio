import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { AppLogo, UserAvatar } from '@renderer/config/env'
import type { UpdateInfo } from 'builder-util-runtime'

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
  minappShow: boolean
  searching: boolean
  filesPath: string
  resourcesPath: string
  update: UpdateState
  export: ExportState
}

export interface ExportState {
  isExporting: boolean
}

const initialState: RuntimeState = {
  avatar: UserAvatar,
  generating: false,
  minappShow: false,
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
    setResourcesPath: (state, action: PayloadAction<string>) => {
      state.resourcesPath = action.payload
    },
    setUpdateState: (state, action: PayloadAction<Partial<UpdateState>>) => {
      state.update = { ...state.update, ...action.payload }
    },
    setExportState: (state, action: PayloadAction<Partial<ExportState>>) => {
      state.export = { ...state.export, ...action.payload }
    }
  }
})

export const {
  setAvatar,
  setGenerating,
  setMinappShow,
  setSearching,
  setFilesPath,
  setResourcesPath,
  setUpdateState,
  setExportState
} = runtimeSlice.actions

export default runtimeSlice.reducer
