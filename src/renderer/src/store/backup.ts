import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface WebDAVSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface LocalBackupSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface BackupState {
  webdavSync: WebDAVSyncState
  localBackupSync: LocalBackupSyncState
}

const initialState: BackupState = {
  webdavSync: {
    lastSyncTime: null,
    syncing: false,
    lastSyncError: null
  },
  localBackupSync: {
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
    setLocalBackupSyncState: (state, action: PayloadAction<Partial<LocalBackupSyncState>>) => {
      state.localBackupSync = { ...state.localBackupSync, ...action.payload }
    }
  }
})

export const { setWebDAVSyncState, setLocalBackupSyncState } = backupSlice.actions
export default backupSlice.reducer
