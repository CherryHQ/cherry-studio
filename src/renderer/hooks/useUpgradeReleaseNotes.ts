import type { UpdateInfo } from 'builder-util-runtime'
import { useEffect, useMemo, useState } from 'react'
import { gt } from 'semver'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { collectUpgradeReleases } from '@renderer/utils/upgradeReleaseNotes'
import type { OutputFor } from '@shared/ipc/types'
import { isStableReleaseVersion } from '@shared/utils/releaseNotes'

const logger = loggerService.withContext('useUpgradeReleaseNotes')
type History = OutputFor<'app.updater.upgrade_notes.get'>

export function useUpgradeReleaseNotes(releaseInfo: UpdateInfo) {
  const target = releaseInfo.version
  const installed = __APP_RELEASE_VERSION__
  const supported = isStableReleaseVersion(installed) && isStableReleaseVersion(target) && gt(target, installed)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ target: string; attempt: number; history: History | null }>()
  const current = result?.target === target && result.attempt === attempt ? result : undefined

  useEffect(() => {
    if (!supported) return
    let active = true
    void ipcApi
      .request('app.updater.upgrade_notes.get', { targetVersion: target })
      .then((history) => {
        if (active) setResult({ target, attempt, history })
      })
      .catch((error: unknown) => {
        logger.warn('Failed to fetch upgrade release notes', { error })
        if (active) setResult({ target, attempt, history: null })
      })
    return () => {
      active = false
    }
  }, [target, attempt, supported])

  const fromVersion = current?.history?.fromVersion ?? installed
  const history = current?.history
  const releases = useMemo(
    () => (supported ? collectUpgradeReleases(fromVersion, releaseInfo, history?.releases ?? []) : []),
    [supported, fromVersion, releaseInfo, history]
  )
  return {
    supported,
    fromVersion,
    releases,
    status: !current ? 'loading' : (current.history?.historyStatus ?? 'unavailable'),
    retry: () => setAttempt((value) => value + 1)
  }
}
