import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import type { InstalledSkill } from '@shared/data/types/agent'
import { useCallback } from 'react'

import type { ResourceAdapter, ResourceListResult } from './types'

/**
 * List hook for skill resources. `GET /skills` is read-only — install / uninstall
 * still ride the IPC channels (`window.api.skill.*`) because they touch the
 * filesystem (clone repos, extract ZIPs, manage symlinks under each agent's
 * `.claude/skills/`) and aren't a good fit for the DataApi contract.
 *
 * No `agentId` is passed: the library list is the global skill library, so
 * `isEnabled` is always `false` here. Per-agent enablement state belongs to
 * the agent editor's Skills tab (`useInstalledSkills(agentId)`).
 */
function useSkillList(): ResourceListResult<InstalledSkill> {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/skills', { query: {} })

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
 * Unwrap the `SkillResult<T>` envelope returned by every `window.api.skill.*`
 * IPC. Throws on failure so callers can use try/catch instead of branching on
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
 * List-level write hook for skills. All three install paths supported by the
 * service are exposed here so the library page can mirror Settings → Skills:
 *
 * - `install({ installSource })`: marketplace handles
 *   (`claude-plugins:owner/repo/path` / `skills.sh:owner/repo[/skill]` /
 *   `clawhub:slug`).
 * - `installFromZip(zipFilePath)`: local ZIP archive.
 * - `installFromDirectory(directoryPath)`: local directory.
 *
 * Each path invalidates `/skills` on success so the list grid picks the new
 * row up immediately without an explicit refetch.
 */
export function useSkillMutations() {
  const invalidate = useInvalidateCache()
  const refresh = useCallback(() => invalidate('/skills'), [invalidate])

  const install = useCallback(
    async (installSource: string): Promise<InstalledSkill> => {
      const result = await window.api.skill.install({ installSource })
      const skill = unwrapSkillResult(result, 'Failed to install skill')
      await refresh()
      return skill
    },
    [refresh]
  )

  const installFromZip = useCallback(
    async (zipFilePath: string): Promise<InstalledSkill> => {
      const result = await window.api.skill.installFromZip({ zipFilePath })
      const skill = unwrapSkillResult(result, 'Failed to install skill from ZIP')
      await refresh()
      return skill
    },
    [refresh]
  )

  const installFromDirectory = useCallback(
    async (directoryPath: string): Promise<InstalledSkill> => {
      const result = await window.api.skill.installFromDirectory({ directoryPath })
      const skill = unwrapSkillResult(result, 'Failed to install skill from directory')
      await refresh()
      return skill
    },
    [refresh]
  )

  return { install, installFromZip, installFromDirectory }
}

/**
 * Per-skill mutation hook. Only uninstall lives here today — toggle is
 * agent-scoped and stays with `useInstalledSkills(agentId)` in the agent
 * editor, since the library list view has no agent context.
 */
export function useSkillMutationsById(id: string) {
  const invalidate = useInvalidateCache()

  const uninstallSkill = useCallback(async (): Promise<void> => {
    const result = await window.api.skill.uninstall(id)
    unwrapSkillResult(result, 'Failed to uninstall skill')
    await invalidate('/skills')
  }, [id, invalidate])

  return { uninstallSkill }
}
