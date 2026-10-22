import { useEffect, useState } from 'react'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'

const logger = loggerService.withContext('useLocalAgentVersion')

export function useLocalAgentVersion(presetId: string | undefined, path: string | undefined) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; current?: string; latest?: string; canUpgrade: boolean }>()
  const key = JSON.stringify([presetId, path, revision])
  useIpcOn('binary.availability_changed', () => setRevision((value) => value + 1))
  useEffect(() => {
    if (!presetId || !path) return
    let active = true
    const refresh = async () => {
      try {
        const current = await ipcApi.request('ai.local_agents.version', { presetId, latest: false })
        if (!active) return
        setResult({ key, ...current })
        const latest = await ipcApi.request('ai.local_agents.version', { presetId, latest: true })
        if (active) setResult({ key, ...latest })
      } catch (error) {
        logger.debug('Agent version lookup unavailable', { presetId, error })
      }
    }
    void refresh()
    return () => {
      active = false
    }
  }, [presetId, path, key])
  return result?.key === key ? result : undefined
}
