import { loggerService } from '@logger'
import { getBackupData } from '@renderer/services/BackupService'
import type { LocalTransferPeer } from '@shared/config/types'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { LanPeerTransferState, LanTransferAction, LanTransferReducerState } from './types'

const logger = loggerService.withContext('useLanTransfer')

// ==========================================
// Initial State
// ==========================================

export const initialState: LanTransferReducerState = {
  open: true,
  lanState: null,
  lanHandshakePeerId: null,
  lastHandshakeResult: null,
  fileTransferState: {},
  tempBackupPath: null
}

// ==========================================
// Reducer
// ==========================================

export function lanTransferReducer(state: LanTransferReducerState, action: LanTransferAction): LanTransferReducerState {
  switch (action.type) {
    case 'SET_OPEN':
      return { ...state, open: action.payload }

    case 'SET_LAN_STATE':
      return { ...state, lanState: action.payload }

    case 'SET_HANDSHAKE_PEER_ID':
      return { ...state, lanHandshakePeerId: action.payload }

    case 'SET_HANDSHAKE_RESULT':
      return { ...state, lastHandshakeResult: action.payload }

    case 'SET_TEMP_BACKUP_PATH':
      return { ...state, tempBackupPath: action.payload }

    case 'UPDATE_TRANSFER_STATE': {
      const { peerId, state: transferState } = action.payload
      return {
        ...state,
        fileTransferState: {
          ...state.fileTransferState,
          [peerId]: {
            ...(state.fileTransferState[peerId] ?? { progress: 0, status: 'idle' as const }),
            ...transferState
          }
        }
      }
    }

    case 'SET_TRANSFER_STATE': {
      const { peerId, state: transferState } = action.payload
      return {
        ...state,
        fileTransferState: {
          ...state.fileTransferState,
          [peerId]: transferState
        }
      }
    }

    case 'CLEANUP_STALE_PEERS': {
      const activeIds = action.payload
      const newFileTransferState: Record<string, LanPeerTransferState> = {}
      for (const id of Object.keys(state.fileTransferState)) {
        if (activeIds.has(id)) {
          newFileTransferState[id] = state.fileTransferState[id]
        }
      }
      return {
        ...state,
        fileTransferState: newFileTransferState,
        lastHandshakeResult:
          state.lastHandshakeResult && activeIds.has(state.lastHandshakeResult.peerId)
            ? state.lastHandshakeResult
            : null,
        lanHandshakePeerId:
          state.lanHandshakePeerId && activeIds.has(state.lanHandshakePeerId) ? state.lanHandshakePeerId : null
      }
    }

    case 'RESET_CONNECTION_STATE':
      return {
        ...state,
        fileTransferState: {},
        lastHandshakeResult: null,
        lanHandshakePeerId: null,
        tempBackupPath: null
      }

    default:
      return state
  }
}

// ==========================================
// Hook Return Type
// ==========================================

export interface UseLanTransferReturn {
  // State
  state: LanTransferReducerState

  // Derived values
  lanDevices: LocalTransferPeer[]
  isAnyTransferring: boolean
  lastError: string | undefined

  // Actions
  handleSendFile: (peerId: string) => Promise<void>
  handleModalCancel: () => void
  getTransferState: (peerId: string) => LanPeerTransferState | undefined
  isConnected: (peerId: string) => boolean
  isHandshakeInProgress: (peerId: string) => boolean

  // Dispatch (for advanced use)
  dispatch: React.Dispatch<LanTransferAction>
}

// ==========================================
// Hook
// ==========================================

export function useLanTransfer(): UseLanTransferReturn {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(lanTransferReducer, initialState)
  const isSendingRef = useRef(false)

  // ==========================================
  // Derived Values
  // ==========================================

  const lanDevices = useMemo(() => state.lanState?.services ?? [], [state.lanState])

  const isAnyTransferring = useMemo(
    () => Object.values(state.fileTransferState).some((s) => s.status === 'transferring' || s.status === 'selecting'),
    [state.fileTransferState]
  )

  const lastError = state.lanState?.lastError

  // ==========================================
  // LAN State Sync
  // ==========================================

  const syncLanState = useCallback(async () => {
    if (!window.api?.localTransfer) {
      logger.warn('Local transfer bridge is unavailable')
      return
    }
    try {
      const nextState = await window.api.localTransfer.getState()
      dispatch({ type: 'SET_LAN_STATE', payload: nextState })
    } catch (error) {
      logger.error('Failed to sync LAN state', error as Error)
    }
  }, [])

  // ==========================================
  // Send File Handler
  // ==========================================

  const handleSendFile = useCallback(
    async (peerId: string) => {
      if (!window.api?.localTransfer || isSendingRef.current) {
        return
      }
      isSendingRef.current = true

      dispatch({
        type: 'SET_TRANSFER_STATE',
        payload: { peerId, state: { progress: 0, status: 'selecting' } }
      })

      let backupPath: string | null = null

      try {
        // Step 0: Ensure handshake (connect if needed)
        if (!state.lastHandshakeResult?.ack.accepted || state.lastHandshakeResult.peerId !== peerId) {
          dispatch({ type: 'SET_HANDSHAKE_PEER_ID', payload: peerId })
          try {
            const ack = await window.api.localTransfer.connect({ peerId })
            dispatch({
              type: 'SET_HANDSHAKE_RESULT',
              payload: { peerId, ack, timestamp: Date.now() }
            })
            if (!ack.accepted) {
              throw new Error(ack.message || t('settings.data.export_to_phone.lan.connection_failed'))
            }
          } finally {
            dispatch({ type: 'SET_HANDSHAKE_PEER_ID', payload: null })
          }
        }

        // Step 1: Create temporary backup
        logger.info('Creating temporary backup for LAN transfer...')
        const backupData = await getBackupData()
        backupPath = await window.api.backup.createLanTransferBackup(backupData)
        dispatch({ type: 'SET_TEMP_BACKUP_PATH', payload: backupPath })

        // Extract filename from path
        const fileName = backupPath.split(/[/\\]/).pop() || 'backup.zip'

        // Step 2: Set transferring state
        dispatch({
          type: 'UPDATE_TRANSFER_STATE',
          payload: { peerId, state: { fileName, progress: 0, status: 'transferring' } }
        })

        // Step 3: Send file
        logger.info(`Sending backup file: ${backupPath}`)
        const result = await window.api.localTransfer.sendFile(backupPath)

        if (result.success) {
          dispatch({
            type: 'UPDATE_TRANSFER_STATE',
            payload: { peerId, state: { progress: 100, status: 'completed' } }
          })
        } else {
          dispatch({
            type: 'UPDATE_TRANSFER_STATE',
            payload: { peerId, state: { status: 'failed', error: result.error } }
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        dispatch({
          type: 'UPDATE_TRANSFER_STATE',
          payload: { peerId, state: { status: 'failed', error: message } }
        })
        logger.error('Failed to send file', error as Error)
      } finally {
        // Step 4: Clean up temp file
        if (backupPath) {
          try {
            await window.api.backup.deleteTempBackup(backupPath)
            logger.info('Cleaned up temporary backup file')
          } catch (cleanupError) {
            logger.warn('Failed to clean up temp backup', cleanupError as Error)
          }
          dispatch({ type: 'SET_TEMP_BACKUP_PATH', payload: null })
        }
        isSendingRef.current = false
      }
    },
    [state.lastHandshakeResult, t]
  )

  // ==========================================
  // Teardown
  // ==========================================

  // Use ref to track temp backup path for cleanup without causing effect re-runs
  const tempBackupPathRef = useRef<string | null>(null)
  tempBackupPathRef.current = state.tempBackupPath

  const teardownLan = useCallback(async () => {
    if (!window.api?.localTransfer) {
      return
    }
    try {
      await window.api.localTransfer.cancelTransfer?.()
    } catch (error) {
      logger.warn('Failed to cancel LAN transfer on close', error as Error)
    }
    try {
      await window.api.localTransfer.disconnect?.()
    } catch (error) {
      logger.warn('Failed to disconnect LAN on close', error as Error)
    }
    // Clean up temp backup if exists (use ref to get current value)
    if (tempBackupPathRef.current) {
      try {
        await window.api.backup.deleteTempBackup(tempBackupPathRef.current)
      } catch (error) {
        logger.warn('Failed to cleanup temp backup on close', error as Error)
      }
    }
    dispatch({ type: 'RESET_CONNECTION_STATE' })
  }, []) // No dependencies - uses ref for current value

  const handleModalCancel = useCallback(() => {
    void teardownLan()
    dispatch({ type: 'SET_OPEN', payload: false })
  }, [teardownLan])

  // ==========================================
  // Effects
  // ==========================================

  // Initial sync and service listener
  useEffect(() => {
    if (!window.api?.localTransfer) {
      return
    }
    syncLanState()
    const removeListener = window.api.localTransfer.onServicesUpdated((lanState) => {
      dispatch({ type: 'SET_LAN_STATE', payload: lanState })
    })
    return () => {
      removeListener?.()
    }
  }, [syncLanState])

  // Client events listener (progress, completion)
  useEffect(() => {
    if (!window.api?.localTransfer) {
      return
    }
    const removeListener = window.api.localTransfer.onClientEvent((event) => {
      const key = event.peerId ?? 'global'

      if (event.type === 'file_transfer_progress') {
        dispatch({
          type: 'UPDATE_TRANSFER_STATE',
          payload: {
            peerId: key,
            state: {
              transferId: event.transferId,
              fileName: event.fileName,
              progress: event.progress,
              speed: event.speed,
              status: 'transferring'
            }
          }
        })
      } else if (event.type === 'file_transfer_complete') {
        dispatch({
          type: 'UPDATE_TRANSFER_STATE',
          payload: {
            peerId: key,
            state: {
              progress: event.success ? 100 : undefined,
              status: event.success ? 'completed' : 'failed',
              error: event.error
            }
          }
        })
      }
    })
    return () => {
      removeListener?.()
    }
  }, [])

  // Cleanup stale peers when services change
  useEffect(() => {
    const activeIds = new Set(lanDevices.map((s) => s.id))
    dispatch({ type: 'CLEANUP_STALE_PEERS', payload: activeIds })
  }, [lanDevices])

  // Cleanup on unmount only (teardownLan is stable with no deps)
  useEffect(() => {
    return () => {
      void teardownLan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ==========================================
  // Helper Functions
  // ==========================================

  const getTransferState = useCallback((peerId: string) => state.fileTransferState[peerId], [state.fileTransferState])

  const isConnected = useCallback(
    (peerId: string) =>
      state.lastHandshakeResult?.peerId === peerId && state.lastHandshakeResult?.ack.accepted === true,
    [state.lastHandshakeResult]
  )

  const isHandshakeInProgress = useCallback(
    (peerId: string) => state.lanHandshakePeerId === peerId,
    [state.lanHandshakePeerId]
  )

  return {
    state,
    lanDevices,
    isAnyTransferring,
    lastError,
    handleSendFile,
    handleModalCancel,
    getTransferState,
    isConnected,
    isHandshakeInProgress,
    dispatch
  }
}
