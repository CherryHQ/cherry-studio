import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useReconcileSkillsOnOpen } from '@renderer/hooks/useSkills'
import { ipcApi } from '@renderer/ipc'
import type { InstalledSkill } from '@shared/data/types/agent'
import { useCallback } from 'react'

import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

const logger = loggerService.withContext('SkillAdapter')

/**
 * List hook for skill resources. `GET /skills` is read-only — install / uninstall
 * still ride the IpcApi routes (`skill.*`) because they touch the
 * filesystem (clone repos, extract ZIPs, manage symlinks under each agent's
 * `.claude/skills/`) and aren't a good fit for the DataApi contract.
 *
 * No `agentId` is passed by the resource library: it reads the global skill
 * library, so `isEnabled` is always `false` there. Per-agent enablement state
 * belongs to the agent edit dialog's Skills tab (`useInstalledSkills(agentId)`).
 *
 * `search` is forwarded to `GET /skills` and evaluated server-side.
 */
function useSkillList(query?: ResourceListQuery): ResourceListResult<InstalledSkill> {
  const enabled = query?.enabled !== false
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/skills', {
    enabled,
    query: {
      ...(query?.search ? { search: query.search } : {})
    }
  })

  // Surface agent-authored skills without an app restart (see the hook's docs). Shared with the
  // agent edit dialog's Skills tab so both entry points reconcile.
  useReconcileSkillsOnOpen(enabled)

  const items = Array.isArray(data) ? data : []
  const stableRefetch = useCallback(() => refetch(), [refetch])

  return {
    data: items,
    isLoading,
    isRefreshing,
    error,
    refetch: stableRefetch
  }
}

export const skillAdapter: ResourceAdapter<InstalledSkill> = {
  resource: 'skill',
  useList: useSkillList
}

/**
 * Unwrap the `SkillResult<T>` envelope returned by every `skill.*` IpcApi
 * route. Throws on failure so callers can use try/catch instead of branching on
 * `result.success` themselves — mirrors how DataApi mutations bubble errors.
 */
function unwrapSkillResult<T>(
  result: { success: true; data: T } | { success: false; error: unknown },
  fallbackMessage: string
): T {
  if (result.success) return result.data
  if (result.error instanceof Error) throw result.error
  throw new Error(typeof result.error === 'string' ? result.error : fallbackMessage)
}

/**
 * Per-skill mutation hook. Only uninstall lives here today; agent-scoped
 * enablement is edited through the agent form and saved via PATCH /agents.
 */
export function useSkillMutationsById(id: string) {
  const invalidate = useInvalidateCache()

  const uninstallSkill = useCallback(async (): Promise<void> => {
    const result = await ipcApi.request('skill.uninstall', { skillId: id })
    unwrapSkillResult(result, 'Failed to uninstall skill')
    try {
      await invalidate('/skills')
    } catch (error) {
      logger.warn('Failed to refresh skills cache after IPC mutation', { error })
    }
  }, [id, invalidate])

  return { uninstallSkill }
}
