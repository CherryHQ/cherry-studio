import { ipcApi, useIpcOn } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { CLI_BINARY_NAMES } from '@shared/data/presets/codeCliTools'
import type { BinaryToolSnapshot } from '@shared/types/binary'
import { CodeCli } from '@shared/types/codeCli'
import { useEffect, useMemo, useRef, useState } from 'react'
import { gt as semverGt, valid as semverValid } from 'semver'

import type { VersionStatus } from '../types'

const logger = loggerService.withContext('useCliVersionStatus')

const isNewerVersion = (latest?: string, installed?: string): boolean => {
  const validLatest = latest ? semverValid(latest) : null
  const validInstalled = installed ? semverValid(installed) : null
  if (!validLatest || !validInstalled) return false
  try {
    return semverGt(validLatest, validInstalled)
  } catch {
    return false
  }
}

const buildStatus = (toolId: CodeCli, snapshot: BinaryToolSnapshot | undefined, latest?: string): VersionStatus => {
  const availability = snapshot?.availability ?? { source: 'none' as const }
  const operation = snapshot?.operation
  const owned = !!snapshot?.intent
  if (availability.source === 'mise') {
    return {
      installed: true,
      source: 'mise',
      owned,
      current: availability.version,
      latest,
      canUpgrade: owned && isNewerVersion(latest, availability.version),
      ...(operation ? { operation } : {})
    }
  }
  if (availability.source === 'bundled') {
    return {
      installed: true,
      source: 'bundled',
      owned,
      current: availability.version,
      canUpgrade: false,
      ...(operation ? { operation } : {})
    }
  }
  if (availability.source === 'system' && toolId !== CodeCli.OPENCLAW) {
    return {
      installed: true,
      source: 'system',
      owned,
      systemPath: availability.path,
      canUpgrade: false,
      ...(operation ? { operation } : {})
    }
  }
  return { installed: false, source: 'none', owned, canUpgrade: false, ...(operation ? { operation } : {}) }
}

/** Availability and managed upgrade status for every CLI tool. */
export const useCliVersionStatuses = (toolIds: readonly CodeCli[]): Record<string, VersionStatus> => {
  const [statuses, setStatuses] = useState<Record<string, VersionStatus>>({})
  const [availabilityRevision, setAvailabilityRevision] = useState(0)
  const latestRef = useRef<Record<string, string | undefined>>({})
  const toolKey = toolIds.join('|')
  const tools = useMemo(() => (toolKey ? (toolKey.split('|') as CodeCli[]) : []), [toolKey])

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      const binaryNames = tools.map((toolId) => CLI_BINARY_NAMES[toolId]).filter((name): name is string => !!name)
      const snapshots = await ipcApi.request('binary.get_tool_snapshots', binaryNames).catch((error) => {
        logger.error('Failed to get CLI tool snapshots', error as Error)
        return null
      })
      if (cancelled || !snapshots) return

      const hasManagedCli = tools.some((toolId) => {
        const snapshot = snapshots[CLI_BINARY_NAMES[toolId]]
        return snapshot?.intent && snapshot.availability.source === 'mise'
      })
      let latestVersions: Record<string, string> = {}
      if (hasManagedCli) {
        latestVersions = await ipcApi.request('binary.get_latest_versions', false).catch((error) => {
          logger.error('Failed to read latest-version cache', error as Error)
          return {}
        })
        if (Object.keys(latestVersions).length === 0 && availabilityRevision === 0) {
          latestVersions = await ipcApi.request('binary.get_latest_versions', true).catch((error) => {
            logger.error('Failed to get latest binary versions', error as Error)
            return {}
          })
        }
      }
      if (cancelled) return

      const next: Record<string, VersionStatus> = {}
      for (const toolId of tools) {
        const binaryName = CLI_BINARY_NAMES[toolId]
        const latest = binaryName ? (latestVersions[binaryName] ?? latestRef.current[toolId]) : undefined
        latestRef.current[toolId] = latest
        next[toolId] = buildStatus(toolId, binaryName ? snapshots[binaryName] : undefined, latest)
      }
      setStatuses(next)
    }

    void refresh()
    return () => {
      cancelled = true
    }
  }, [availabilityRevision, toolKey, tools])

  useIpcOn('binary.availability_changed', () => {
    setAvailabilityRevision((revision) => revision + 1)
  })

  return statuses
}
