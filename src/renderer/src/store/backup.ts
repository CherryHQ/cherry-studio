import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface RemoteSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface BackupState {
  webdavSync: RemoteSyncState
  s3Sync: RemoteSyncState
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
    setWebDAVSyncState: (state, action: PayloadAction<Partial<RemoteSyncState>>) => {
      state.webdavSync = { ...state.webdavSync, ...action.payload }
    },
    setS3SyncState: (state, action: PayloadAction<Partial<RemoteSyncState>>) => {
      state.s3Sync = { ...state.s3Sync, ...action.payload }
    }
  }
})

export const { setWebDAVSyncState, setS3SyncState } = backupSlice.actions
export default backupSlice.reducer
