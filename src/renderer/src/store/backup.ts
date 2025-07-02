import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface WebDAVSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface BackupState {
  webdavSync: WebDAVSyncState
}

const initialState: BackupState = {
  webdavSync: {
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
    }
  }
})

export const { setWebDAVSyncState } = backupSlice.actions
export default backupSlice.reducer
