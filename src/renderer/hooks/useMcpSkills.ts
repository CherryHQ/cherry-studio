import { useEffect, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { McpSkillEntry } from '@shared/types/mcpSkills'

const logger = loggerService.withContext('useMcpSkills')
const EMPTY: readonly SkillCatalogResult[] = []
type SkillCatalogResult = { serverId: string; skills: McpSkillEntry[]; error?: string }

/** Discovery is scoped to the visible picker; closing it cancels outstanding requests. */
export function useMcpSkills(serverIds: readonly string[], enabled: boolean): readonly SkillCatalogResult[] {
  const key = JSON.stringify([...new Set(serverIds)].sort())
  const [result, setResult] = useState<{ key: string; catalogs: SkillCatalogResult[] }>()
  useEffect(() => {
    if (!enabled) return
    const ids: string[] = JSON.parse(key)
    const requests = ids.map((serverId) => ({ serverId, requestId: crypto.randomUUID() }))
    let cancelled = false
    void Promise.all(
      requests.map(async ({ serverId, requestId }): Promise<SkillCatalogResult> => {
        try {
          return { serverId, skills: await ipcApi.request('mcp.server.list_skills', { serverId, requestId }) }
        } catch (error) {
          return { serverId, skills: [], error: error instanceof Error ? error.message : String(error) }
        }
      })
    ).then((catalogs) => {
      if (!cancelled) setResult({ key, catalogs })
    })
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
