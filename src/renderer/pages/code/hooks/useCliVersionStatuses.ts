import { ipcApi, useIpcOn } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import type { BinaryState } from '@shared/data/preference/preferenceTypes'
import type { CodeCli } from '@shared/types/codeCli'
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

const buildStatus = (state: BinaryState, binaryName: string | undefined, latest?: string): VersionStatus => {
  const installed = binaryName ? state.tools[binaryName] : undefined
  return {
    installed: !!installed,
    current: installed?.version,
    latest,
    canUpgrade: !!installed && isNewerVersion(latest, installed.version)
  }
}

/**
 * Install/upgrade status for every CLI tool.
 *
 * Installed state comes from `binary.get_state`; latest versions come from
 * BinaryManager's `mise latest` batch. We only run the latest-version batch when
 * at least one supported CLI is installed, because upgrade badges are the only
 * consumer on this page.
 */
export const useCliVersionStatuses = (toolIds: readonly CodeCli[]): Record<string, VersionStatus> => {
  const [statuses, setStatuses] = useState<Record<string, VersionStatus>>({})
  // Latest versions survive the `binary.state_changed` broadcast (which carries
  // installed state only) so canUpgrade stays accurate without a registry re-query.
  const latestRef = useRef<Record<string, string | undefined>>({})
  const toolKey = toolIds.join('|')
  const tools = useMemo(() => (toolKey ? (toolKey.split('|') as CodeCli[]) : []), [toolKey])

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      const state = await ipcApi.request('binary.get_state').catch((error) => {
        logger.error('Failed to get binary state', error as Error)
        return null
      })

      if (cancelled || !state) return

      const hasInstalledCli = tools.some((toolId) => {
        const binaryName = CLI_BINARY_NAMES[toolId]
        return binaryName ? Boolean(state.tools[binaryName]) : false
      })
      const latestVersions = hasInstalledCli
        ? await ipcApi.request('binary.get_latest_versions', true).catch((error) => {
            logger.error('Failed to get latest binary versions', error as Error)
            return {}
          })
        : {}
      if (cancelled) return

      for (const toolId of tools) {
        const binaryName = CLI_BINARY_NAMES[toolId]
        latestRef.current[toolId] = binaryName ? latestVersions[binaryName] : undefined
      }

      const next: Record<string, VersionStatus> = {}
      for (const toolId of tools) {
        next[toolId] = buildStatus(state, CLI_BINARY_NAMES[toolId], latestRef.current[toolId])
      }
      setStatuses(next)
    }

    void refresh()
    return () => {
      cancelled = true
    }
  }, [toolKey, tools])

  useIpcOn('binary.state_changed', (state) => {
    const next: Record<string, VersionStatus> = {}
    for (const toolId of tools) {
      next[toolId] = buildStatus(state, CLI_BINARY_NAMES[toolId], latestRef.current[toolId])
    }
    setStatuses(next)
  })

  return statuses
}
