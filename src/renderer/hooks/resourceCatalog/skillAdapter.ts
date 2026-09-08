import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useInvalidateSkills, useSkillCatalog } from '@renderer/hooks/useSkills'
import { ipcApi } from '@renderer/ipc'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { SkillCatalogEntry } from '@shared/types/skill'
import { useCallback } from 'react'

import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

const logger = loggerService.withContext('SkillAdapter')

/** Catalog reads include filesystem scope via IPC; per-agent lists remain SQLite-backed. */
function useSkillList(query?: ResourceListQuery): ResourceListResult<SkillCatalogEntry> {
  return useSkillCatalog(query?.search, query?.enabled !== false)
}

export const skillAdapter: ResourceAdapter<SkillCatalogEntry> = {
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
 * Per-skill library mutations. Agent-scoped enablement remains owned by the
 * agent form and is saved via PATCH /agents.
 */
export function useSkillMutationsById(id: string) {
  const invalidate = useInvalidateSkills()
  const path = `/skills/${id}` as const
  const { trigger: updateTrigger, isLoading: isUpdating } = useMutation('PATCH', path, {
    refresh: ['/skills', path]
  })

  const updateGlobalEnabled = useCallback(
    (isGlobalEnabled: boolean): Promise<InstalledSkill> => updateTrigger({ body: { isGlobalEnabled } }),
    [updateTrigger]
  )

  const uninstallSkill = useCallback(async (): Promise<void> => {
    const result = await ipcApi.request('skill.uninstall', { skillId: id })
    unwrapSkillResult(result, 'Failed to uninstall skill')
    try {
      await invalidate()
    } catch (error) {
      logger.warn('Failed to refresh skills cache after IPC mutation', { error })
    }
  }, [id, invalidate])

  return { uninstallSkill, updateGlobalEnabled, isUpdating }
}
