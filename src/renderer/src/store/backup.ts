import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface WebDAVSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface GoogleDriveSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface OneDriveSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface BackupState {
  webdavSync: WebDAVSyncState
  googleDriveSync: GoogleDriveSyncState
  oneDriveSync: OneDriveSyncState
}

const initialState: BackupState = {
  webdavSync: {
    lastSyncTime: null,
    syncing: false,
    lastSyncError: null
  },
  googleDriveSync: {
    lastSyncTime: null,
    syncing: false,
    lastSyncError: null
  },
  oneDriveSync: {
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
    setGoogleDriveSyncState: (state, action: PayloadAction<Partial<GoogleDriveSyncState>>) => {
      state.googleDriveSync = { ...state.googleDriveSync, ...action.payload }
    },
    setOneDriveSyncState: (state, action: PayloadAction<Partial<OneDriveSyncState>>) => {
      state.oneDriveSync = { ...state.oneDriveSync, ...action.payload }
    }
  }
})

export const { setWebDAVSyncState, setGoogleDriveSyncState, setOneDriveSyncState } = backupSlice.actions
export default backupSlice.reducer
