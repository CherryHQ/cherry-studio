import { useSharedCacheValue } from '@data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import type { ManagedToolStatusState } from '@shared/types/managedTool'
import { useEffect } from 'react'

const logger = loggerService.withContext('useManagedToolStatus')

export type ManagedTool = 'deepseek-harness' | 'openclaw'

const STOPPED: ManagedToolStatusState = { status: 'stopped' }

/**
 * Reads the main-owned shared status snapshot. OpenClaw keeps its command request
 * only as an on-selection liveness probe for gateways started outside Cherry Studio.
 */
export function useManagedToolStatus(tool: ManagedTool, enabled: boolean): ManagedToolStatusState {
  const deepSeek = useSharedCacheValue('feature.deepseek_harness.status')
  const openClaw = useSharedCacheValue('feature.openclaw.gateway_status')

  useEffect(() => {
    if (!enabled || tool !== 'openclaw') return
    void ipcApi
      .request('openclaw.get_status')
      .catch((error) => logger.error('Failed to probe OpenClaw status', error as Error))
  }, [enabled, tool])

  if (!enabled) return STOPPED
  if (tool === 'deepseek-harness') return deepSeek ?? STOPPED
  return { status: openClaw ?? 'stopped' }
}
