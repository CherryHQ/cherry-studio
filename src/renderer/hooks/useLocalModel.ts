import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { LocalModelKind, LocalModelStatus } from '@shared/data/presets/localModel'
import { useCallback, useEffect, useRef, useState } from 'react'

export function useLocalModel(model: LocalModelKind) {
  const [status, setStatus] = useState<LocalModelStatus>('not_downloaded')
  const [percent, setPercent] = useState(0)
  const mountedRef = useRef(true)
  const cancellingRef = useRef(false)

  const refreshStatus = useCallback(async () => {
    try {
      const result = await ipcApi.request('local_model.get_status', { model })
      if (mountedRef.current) {
        setStatus(result.status)
      }
    } catch {
      // Status probing is best-effort; keep the last observed state.
    }
  }, [model])

  useEffect(() => {
    mountedRef.current = true
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
    if (progress.status === 'ready') {
      setStatus('ready')
    } else if (progress.status === 'error') {
      setStatus('error')
    } else {
      setStatus('downloading')
    }
  })

  const download = useCallback(async () => {
    cancellingRef.current = false
    if (mountedRef.current) {
      setStatus('downloading')
      setPercent(0)
    }

    try {
      await ipcApi.request('local_model.download', { model })
      if (!mountedRef.current) {
        return false
      }
      setStatus('ready')
      setPercent(100)
      return true
    } catch (error) {
      if (cancellingRef.current || !mountedRef.current) {
        return false
      }
      setStatus('error')
      throw error
    }
  }, [model])

  const cancel = useCallback(async () => {
    cancellingRef.current = true
    try {
      await ipcApi.request('local_model.cancel', { model })
    } finally {
      if (mountedRef.current) {
        setStatus('not_downloaded')
        setPercent(0)
      }
    }
  }, [model])

  const remove = useCallback(async () => {
    const result = await ipcApi.request('local_model.remove', { model })
    if (result.removed && mountedRef.current) {
      setStatus('not_downloaded')
      setPercent(0)
    }
    return result
  }, [model])

  return { status, percent, download, cancel, remove }
}
