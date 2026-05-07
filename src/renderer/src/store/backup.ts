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

export interface RemoteSyncState {
  lastSyncTime: number | null
  syncing: boolean
  lastSyncError: string | null
}

export interface BackupState {
  webdavSync: RemoteSyncState
  localBackupSync: RemoteSyncState
  s3Sync: RemoteSyncState
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
    setLocalBackupSyncState: (state, action: PayloadAction<Partial<RemoteSyncState>>) => {
      state.localBackupSync = { ...state.localBackupSync, ...action.payload }
    },
    setS3SyncState: (state, action: PayloadAction<Partial<RemoteSyncState>>) => {
      state.s3Sync = { ...state.s3Sync, ...action.payload }
    }
  }
})

export const { setWebDAVSyncState, setLocalBackupSyncState, setS3SyncState } = backupSlice.actions
export default backupSlice.reducer
