import { ipcApi } from '@renderer/ipc'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { loggerService } from '@renderer/services/LoggerService'
import type { BinaryState } from '@shared/data/preference/preferenceTypes'
import { codeCLI } from '@shared/types/codeCli'
import { useEffect, useRef, useState } from 'react'

import { CLI_BINARY_NAMES } from './cliTools'
import type { VersionStatus } from './types'

const logger = loggerService.withContext('useCliVersionStatus')

type RegistryEntry = { name: string; tool: string }

/** Pull a trailing `@1.2.3` off a mise tool spec, if the registry pinned one. */
const extractVersion = (tool: string): string | undefined => {
  const match = tool.match(/@([\d.]+)$/)
  return match ? match[1] : undefined
}

const buildStatus = (state: BinaryState, binaryName: string | undefined, latest?: string): VersionStatus => {
  const installed = binaryName ? state.tools[binaryName] : undefined
  return {
    installed: !!installed,
    current: installed?.version,
    latest,
    canUpgrade: !!installed && !!latest && installed.version !== latest
  }
}

/**
 * Install/upgrade status for every CLI tool.
 *
 * Installed state comes from `binary.get_state`; the registry "latest" version
 * is resolved per tool from `binary.search_registry`. Both run in a single
 * parallel batch — they're independent — so the registry lookups add no latency
 * on top of the state fetch. On `binary.state_changed` we recompute from the
 * broadcast without re-querying the registry (cached in `latestRef`).
 *
 * NOTE: `mise registry` entries carry versionless backend specs (e.g.
 * `npm:opencode`), so `extractVersion` typically returns undefined and
 * `canUpgrade` stays false until a real latest-version source (npm/pypi via
 * `CodeCliService.getVersionInfo`) is wired up. The installed/current fields
 * are unaffected and always accurate.
 */
export const useCliVersionStatuses = (toolIds: readonly codeCLI[]): Record<string, VersionStatus> => {
  const [statuses, setStatuses] = useState<Record<string, VersionStatus>>({})
  // Latest versions survive the `binary.state_changed` broadcast (which carries
  // installed state only) so canUpgrade stays accurate without a registry re-query.
  const latestRef = useRef<Record<string, string | undefined>>({})
  const toolKey = toolIds.join('|')

  useEffect(() => {
    let cancelled = false
    const tools = [...toolIds]

    const refresh = async () => {
      const [state, registry] = await Promise.all([
        ipcApi.request('binary.get_state').catch((error) => {
          logger.error('Failed to get binary state', error as Error)
          return null
        }),
        Promise.all(
          tools.map(async (toolId): Promise<readonly [codeCLI, string | undefined]> => {
            const binaryName = CLI_BINARY_NAMES[toolId]
            if (!binaryName) return [toolId, undefined]
            try {
              const results = await ipcApi.request('binary.search_registry', binaryName)
              const match = (results as RegistryEntry[]).find((r) => r.name === binaryName)
              return [toolId, match ? extractVersion(match.tool) : undefined]
            } catch (error) {
              logger.error('Failed to search registry', error as Error)
              return [toolId, undefined]
            }
          })
        )
      ])

      if (cancelled || !state) return
      for (const [toolId, version] of registry) latestRef.current[toolId] = version

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
    // `toolIds` is a stable module-level constant; keying the effect on its joined
    // value avoids re-fetching on referential-identity changes alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolKey])

  useIpcOn('binary.state_changed', (state) => {
    const next: Record<string, VersionStatus> = {}
    for (const toolId of toolIds) {
      next[toolId] = buildStatus(state, CLI_BINARY_NAMES[toolId], latestRef.current[toolId])
    }
    setStatuses(next)
  })

  return statuses
}
