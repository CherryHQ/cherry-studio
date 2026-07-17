import { ipcApi, useIpcOn } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { interpretBinarySnapshot } from '@renderer/utils/binarySnapshot'
import { CODE_CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import type { BinaryToolSnapshot } from '@shared/types/binary'
import { CodeCli } from '@shared/types/codeCli'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { VersionStatus } from '../types'

const logger = loggerService.withContext('useCliVersionStatus')

const buildStatus = (toolId: CodeCli, snapshot: BinaryToolSnapshot | undefined, latest?: string): VersionStatus => {
  const view = interpretBinarySnapshot(snapshot, { latest, ignoreSystemSource: toolId === CodeCli.OPENCLAW })
  const operation = snapshot?.operation
  const intent = snapshot?.intent
  return {
    installed: view.installed,
    source: view.source,
    owned: view.owned,
    // Backend-application fact drives update/uninstall authority (fixed identity
    // comes from the preset, not durable ownership).
    ...(view.applicationStatus ? { applicationStatus: view.applicationStatus } : {}),
    ...(intent ? { intent } : {}),
    ...(view.installedVersion !== undefined ? { current: view.installedVersion } : {}),
    ...(view.source === 'mise' ? { latest } : {}),
    ...(view.systemPath !== undefined ? { systemPath: view.systemPath } : {}),
    canUpgrade: view.hasUpdate,
    ...(operation ? { operation } : {})
  }
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
      const binaryNames = tools.map((toolId) => CODE_CLI_TOOL_PRESET_MAP[toolId].executable)
      const snapshots = await ipcApi.request('binary.get_tool_snapshots', binaryNames).catch((error) => {
        logger.error('Failed to get CLI tool snapshots', error as Error)
        return null
      })
      if (cancelled || !snapshots) return

      for (const toolId of tools) {
        // Latest applies only to an exactly-applied fixed snapshot — not durable
        // intent, which a fixed CLI never carries.
        if (snapshots[CODE_CLI_TOOL_PRESET_MAP[toolId].executable]?.application?.status !== 'applied') {
          delete latestRef.current[toolId]
        }
      }
      const hasAppliedCli = tools.some(
        (toolId) => snapshots[CODE_CLI_TOOL_PRESET_MAP[toolId].executable]?.application?.status === 'applied'
      )
      let latestVersions: Record<string, string> = {}
      if (hasAppliedCli) {
        latestVersions = await ipcApi.request('binary.get_latest_versions', false).catch((error) => {
          logger.error('Failed to read latest-version cache', error as Error)
          return {}
        })
        const needsLatest = tools.some((toolId) => {
          const binaryName = CODE_CLI_TOOL_PRESET_MAP[toolId].executable
          const snapshot = snapshots[binaryName]
          return (
            snapshot?.application?.status === 'applied' && !latestVersions[binaryName] && !latestRef.current[toolId]
          )
        })
        if (needsLatest) {
          latestVersions = await ipcApi.request('binary.get_latest_versions', true).catch((error) => {
            logger.error('Failed to get latest binary versions', error as Error)
            return {}
          })
        }
      }
      if (cancelled) return

      const next: Record<string, VersionStatus> = {}
      for (const toolId of tools) {
        const binaryName = CODE_CLI_TOOL_PRESET_MAP[toolId].executable
        const latest = latestVersions[binaryName] ?? latestRef.current[toolId]
        latestRef.current[toolId] = latest
        next[toolId] = buildStatus(toolId, snapshots[binaryName], latest)
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
