import { useEffect, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { McpSkillEntry } from '@shared/types/mcpSkills'

const logger = loggerService.withContext('useMcpSkills')
const EMPTY: readonly SkillCatalogResult[] = []
type SkillCatalogResult = { serverId: string; skills: McpSkillEntry[]; error?: string }

/** Discovery is scoped to its visible consumer; unmounting cancels outstanding requests. */
export function useMcpSkills(
  serverIds: readonly string[],
  enabled: boolean,
  includeDisabled = false
): readonly SkillCatalogResult[] {
  const key = JSON.stringify({ serverIds: [...new Set(serverIds)].sort(), includeDisabled })
  const [result, setResult] = useState<{ key: string; catalogs: SkillCatalogResult[] }>()
  useEffect(() => {
    if (!enabled) return
    const query: { serverIds: string[]; includeDisabled: boolean } = JSON.parse(key)
    const ids = query.serverIds
    const requests = ids.map((serverId) => ({ serverId, requestId: crypto.randomUUID() }))
    const catalogs = new Map<string, SkillCatalogResult>()
    let cancelled = false
    for (const { serverId, requestId } of requests) {
      void (async () => {
        let catalog: SkillCatalogResult
        try {
          catalog = {
            serverId,
            skills: await ipcApi.request('mcp.server.list_skills', {
              serverId,
              requestId,
              ...(query.includeDisabled ? { includeDisabled: true } : {})
            })
          }
        } catch (error) {
          catalog = { serverId, skills: [], error: error instanceof Error ? error.message : String(error) }
        }
        if (cancelled) return
        catalogs.set(serverId, catalog)
        setResult({ key, catalogs: ids.flatMap((id) => catalogs.get(id) ?? []) })
      })()
    }
    return () => {
      cancelled = true
      for (const { requestId } of requests) {
        void ipcApi.request('mcp.request.cancel', { requestId }).catch((error) => {
          logger.warn('Failed to cancel skill discovery', { error })
        })
      }
    }
  }, [key, enabled])
  return enabled && result?.key === key ? result.catalogs : EMPTY
}
