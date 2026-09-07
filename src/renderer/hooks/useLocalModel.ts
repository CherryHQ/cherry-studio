import { useSharedCacheValue } from '@data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import { LOCAL_MODEL_STATUS_CACHE_KEY, type LocalModelBundleId } from '@shared/data/presets/localModel'
import { useCallback, useEffect } from 'react'

export function useLocalModel(id: LocalModelBundleId) {
  const snapshots = useSharedCacheValue(LOCAL_MODEL_STATUS_CACHE_KEY)
  const snapshot = snapshots?.[id]

  useEffect(() => {
    void ipcApi.request('local_model.get_status', { id }).catch(() => {})
  }, [id])

  const download = useCallback(async () => {
    const result = await ipcApi.request('local_model.download', { id })
    return result.result === 'ready'
  }, [id])

  const cancel = useCallback(() => ipcApi.request('local_model.cancel', { id }), [id])

  const remove = useCallback(() => ipcApi.request('local_model.remove', { id }), [id])

  return {
    status: snapshot?.status ?? 'not_downloaded',
    errorCode: snapshot?.errorCode ?? null,
    isStatusResolved: snapshot !== undefined,
    percent: snapshot?.percent ?? 0,
    download,
    cancel,
    remove
  }
}
