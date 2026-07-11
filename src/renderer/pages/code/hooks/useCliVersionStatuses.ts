import { ipcApi, useIpcOn } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import type { BinaryResolution } from '@shared/types/binary'
import { CodeCli } from '@shared/types/codeCli'
import { useEffect, useMemo, useRef, useState } from 'react'
import { gt as semverGt, valid as semverValid } from 'semver'

import { CLI_BINARY_NAMES } from '../constants/cliTools'
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

const buildStatus = (toolId: CodeCli, resolution: BinaryResolution, latest?: string): VersionStatus => {
  if (resolution.source === 'managed') {
    return {
      installed: true,
      source: 'managed',
      current: resolution.version,
      latest,
      canUpgrade: isNewerVersion(latest, resolution.version)
    }
  }
  if (resolution.source === 'bundled') {
    return {
      installed: true,
      source: 'bundled',
      current: resolution.version,
      canUpgrade: false
    }
  }
  if (resolution.source === 'system' && toolId !== CodeCli.OPENCLAW) {
    return { installed: true, source: 'system', systemPath: resolution.path, canUpgrade: false }
  }
  return { installed: false, source: 'none', canUpgrade: false }
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
      const resolutions = await ipcApi.request('binary.resolve_tools', binaryNames).catch((error) => {
        logger.error('Failed to resolve CLI tools', error as Error)
        return null
      })
      if (cancelled || !resolutions) return

      const hasManagedCli = tools.some((toolId) => resolutions[CLI_BINARY_NAMES[toolId]]?.source === 'managed')
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
        next[toolId] = buildStatus(toolId, resolutions[binaryName] ?? { source: 'none' }, latest)
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
