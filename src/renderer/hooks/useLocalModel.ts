import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { LocalModelErrorCode, LocalModelKind, LocalModelStatus } from '@shared/data/presets/localModel'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Status and its error cause form one value: every transition replaces both, so a
 * status written by one path can never be displayed with an errorCode left behind
 * by another (e.g. a transport-failed retry showing the incomplete-cache notice).
 */
interface LocalModelState {
  status: LocalModelStatus
  errorCode: LocalModelErrorCode | null
}

export function useLocalModel(model: LocalModelKind) {
  const [state, setState] = useState<LocalModelState>({ status: 'not_downloaded', errorCode: null })
  const [isStatusResolved, setIsStatusResolved] = useState(false)
  const [percent, setPercent] = useState(0)
  const mountedRef = useRef(true)

  const refreshStatus = useCallback(async () => {
    try {
      const result = await ipcApi.request('local_model.get_status', { model })
      if (mountedRef.current) {
        setState({ status: result.status, errorCode: result.errorCode ?? null })
        setIsStatusResolved(true)
      }
    } catch {
      // Status probing is best-effort; keep the last observed state.
    }
  }, [model])

  useEffect(() => {
    mountedRef.current = true
    setIsStatusResolved(false)
    void refreshStatus()
    return () => {
      mountedRef.current = false
    }
  }, [refreshStatus])

  useIpcOn('local_model.download_progress', (progress) => {
    if (!mountedRef.current || progress.model !== model) {
      return
    }

    setPercent(progress.percent)
    setIsStatusResolved(true)
    if (progress.status === 'ready') {
      setState({ status: 'ready', errorCode: null })
    } else if (progress.status === 'error') {
      setState({ status: 'error', errorCode: progress.errorCode ?? 'download_failed' })
    } else if (progress.status === 'not_downloaded') {
      setState({ status: 'not_downloaded', errorCode: null })
      setPercent(0)
    } else {
      setState({ status: 'downloading', errorCode: null })
    }
  })

  const download = useCallback(async () => {
    if (mountedRef.current) {
      setState({ status: 'downloading', errorCode: null })
      setPercent(0)
    }

    try {
      const result = await ipcApi.request('local_model.download', { model })
      if (!mountedRef.current) {
        return false
      }
      if (result.result === 'cancelled') {
        setState({ status: 'not_downloaded', errorCode: null })
        setPercent(0)
        return false
      }
      setState({ status: 'ready', errorCode: null })
      setPercent(100)
      return true
    } catch (error) {
      if (!mountedRef.current) {
        return false
      }
      setState({ status: 'error', errorCode: 'download_failed' })
      throw error
    }
  }, [model])

  const cancel = useCallback(async () => {
    try {
      await ipcApi.request('local_model.cancel', { model })
    } finally {
      if (mountedRef.current) {
        setState({ status: 'not_downloaded', errorCode: null })
        setPercent(0)
      }
    }
  }, [model])

  const remove = useCallback(async () => {
    const result = await ipcApi.request('local_model.remove', { model })
    if (result.removed && mountedRef.current) {
      setState({ status: 'not_downloaded', errorCode: null })
      setPercent(0)
    }
    return result
  }, [model])

  return { status: state.status, errorCode: state.errorCode, isStatusResolved, percent, download, cancel, remove }
}
