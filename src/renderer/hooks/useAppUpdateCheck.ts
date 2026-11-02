import { useCallback, useRef, useSyncExternalStore } from 'react'

import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { appUpdateCheckService } from '@renderer/services/AppUpdateCheckService'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'

/** A manual "already current" result is not a failure. */
export function updateNoticeIsFailure(key: string | null): boolean {
  return key === 'settings.about.updateError' || key === 'settings.about.updateNotPublished'
}

export function updateCheckLabelKey(
  state: Pick<CacheAppUpdateState, 'checking' | 'downloading' | 'downloaded'>
): string {
  if (state.checking) return 'settings.about.checking'
  if (state.downloading) return 'settings.about.downloading'
  if (state.downloaded) return 'settings.about.checkUpdate.available'
  return 'settings.about.checkUpdate.label'
}

/** Shared updater control for About settings and the error detail modal. */
export function useAppUpdateCheck() {
  const { appUpdateState, updateAppUpdateState } = useAppUpdateState()
  const stateRef = useRef(appUpdateState)
  stateRef.current = appUpdateState
  const noticeKey = useSyncExternalStore(
    appUpdateCheckService.subscribeUpdateNotice,
    appUpdateCheckService.readUpdateNotice,
    appUpdateCheckService.readUpdateNotice
  )

  const checkForUpdate = useCallback(() => {
    void appUpdateCheckService.runAppUpdateCheck(stateRef.current, updateAppUpdateState).catch(() => {
      appUpdateCheckService.setUpdateNotice('settings.about.updateError')
    })
  }, [updateAppUpdateState])

  return { appUpdateState, updateAppUpdateState, noticeKey, checkForUpdate }
}
