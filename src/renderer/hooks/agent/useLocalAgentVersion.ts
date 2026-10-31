import { useEffect, useState } from 'react'

import { useCache } from '@data/hooks/useCache'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'

const logger = loggerService.withContext('useLocalAgentVersion')

export function useLocalAgentVersion(presetId: string | undefined, path: string | undefined) {
  const [revision, setRevision] = useState(0)
  const [versions, setVersions] = useCache('local_agent.versions')
  useIpcOn('binary.availability_changed', () => setRevision((value) => value + 1))
  useEffect(() => {
    if (!presetId || !path) return
    let active = true
    const refresh = async () => {
      try {
        const current = await ipcApi.request('ai.local_agents.version', { presetId, latest: false })
        if (!active) return
        setVersions((previous) => ({
          ...previous,
          [presetId]:
            previous[presetId]?.path === path && previous[presetId]?.current === current.current
              ? previous[presetId]
              : { path, ...current }
        }))
        const latest = await ipcApi.request('ai.local_agents.version', { presetId, latest: true })
        if (active) setVersions((previous) => ({ ...previous, [presetId]: { path, ...latest } }))
      } catch (error) {
        logger.debug('Agent version lookup unavailable', { presetId, error })
      }
    }
    void refresh()
    return () => {
      active = false
    }
  }, [presetId, path, revision, setVersions])
  const result = presetId ? versions[presetId] : undefined
  return path && result?.path === path ? result : undefined
}
