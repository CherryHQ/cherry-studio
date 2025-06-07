import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface WebDAVSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface BackupState {
  webdavSync: WebDAVSyncState
  s3Sync: WebDAVSyncState
}

const initialState: BackupState = {
  webdavSync: {
    lastSyncTime: null,
    syncing: false,
    lastSyncError: null
  },
  s3Sync: {
    lastSyncTime: null,
    syncing: false,
    lastSyncError: null
  }
}

const backupSlice = createSlice({
  name: 'backup',
  initialState,
  reducers: {
    setWebDAVSyncState: (state, action: PayloadAction<Partial<WebDAVSyncState>>) => {
      state.webdavSync = { ...state.webdavSync, ...action.payload }
    },
    setS3SyncState: (state, action: PayloadAction<Partial<WebDAVSyncState>>) => {
      state.s3Sync = { ...state.s3Sync, ...action.payload }
    }
  }
})

export const { setWebDAVSyncState, setS3SyncState } = backupSlice.actions
export default backupSlice.reducer
