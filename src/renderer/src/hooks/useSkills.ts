import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { searchSkills } from '@renderer/services/SkillSearchService'
import type { InstalledSkill, SkillResult, SkillSearchResult } from '@types'
import { useCallback, useRef, useState } from 'react'

const logger = loggerService.withContext('useSkills')

function skillErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error')
}

function unwrapSkillResult<T>(result: SkillResult<T>): T {
  if (result.success) return result.data
  throw new Error(skillErrorMessage(result.error))
}

function reportSkillMutationError(action: string, error: unknown): string {
  const message = skillErrorMessage(error)
  logger.error(`Failed to ${action}`, { error: message })
  window.toast.error(message)
  return message
}

async function refreshSkillsBestEffort(invalidate: ReturnType<typeof useInvalidateCache>): Promise<void> {
  try {
    await invalidate('/skills')
  } catch (error) {
    logger.warn('Failed to refresh skills cache after IPC mutation', { error })
  }
}

/**
 * Hook to manage installed skills.
 *
 * Pass `agentId` to get per-agent enablement state and to scope toggle calls
 * to that agent. Without `agentId`, the hook returns the global skill library
 * with `isEnabled` forced to false — callers without an agent context (e.g.
 * the global Settings → Skills page) should rely on uninstall only.
 */
export function useInstalledSkills(agentId?: string) {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery(
    '/skills',
    agentId ? { query: { agentId } } : undefined
  )
  const invalidate = useInvalidateCache()

  const toggle = useCallback(
    async (skillId: string, isEnabled: boolean) => {
      if (!agentId) {
        // Without an agent context there is nothing to toggle — per-agent
        // enablement has no target. Callers that want to toggle must scope
        // to an agent.
        return false
      }
      try {
        const result = await window.api.skill.toggle({ agentId, skillId, isEnabled })
        if (!result.success || !result.data) return false
        await refreshSkillsBestEffort(invalidate)
        return result.data.isEnabled === isEnabled
      } catch (error) {
        reportSkillMutationError('toggle skill', error)
        return false
      }
    },
    [agentId, invalidate]
  )

  const uninstall = useCallback(
    async (skillId: string) => {
      try {
        const result = await window.api.skill.uninstall(skillId)
        if (!result.success) return false
        await refreshSkillsBestEffort(invalidate)
        return true
      } catch (error) {
        reportSkillMutationError('uninstall skill', error)
        return false
      }
    },
    [invalidate]
  )

  return {
    skills: data ?? [],
    loading: isLoading || isRefreshing,
    error: error?.message ?? null,
    refresh: refetch,
    toggle,
    uninstall
  }
}

/**
 * Hook for searching skills across all 3 registries.
 */
export function useSkillSearch() {
  const [results, setResults] = useState<SkillSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(0)

  const search = useCallback(async (query: string) => {
    const requestId = ++abortRef.current

    if (!query.trim()) {
      setResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    setError(null)

    try {
      const data = await searchSkills(query)
      if (requestId === abortRef.current) {
        setResults(data)
      }
    } catch (err) {
      if (requestId === abortRef.current) {
        setError(err instanceof Error ? err.message : 'Search failed')
      }
    } finally {
      if (requestId === abortRef.current) {
        setSearching(false)
      }
    }
  }, [])

  const clear = useCallback(() => {
    abortRef.current++
    setResults([])
    setSearching(false)
    setError(null)
  }, [])

  return { results, searching, error, search, clear }
}

/**
 * Hook for installing a skill from search results.
 */
export function useSkillInstall() {
  const [installingKey, setInstallingKey] = useState<string | null>(null)
  const invalidate = useInvalidateCache()

  const install = useCallback(
    async (installSource: string): Promise<{ skill: InstalledSkill | null; error?: string }> => {
      setInstallingKey(installSource)
      try {
        const skill = unwrapSkillResult(await window.api.skill.install({ installSource }))
        await refreshSkillsBestEffort(invalidate)
        return { skill }
      } catch (err) {
        return { skill: null, error: skillErrorMessage(err) }
      } finally {
        setInstallingKey(null)
      }
    },
    [invalidate]
  )

  const installFromZip = useCallback(
    async (zipFilePath: string): Promise<InstalledSkill | null> => {
      setInstallingKey('zip')
      try {
        const skill = unwrapSkillResult(await window.api.skill.installFromZip({ zipFilePath }))
        await refreshSkillsBestEffort(invalidate)
        return skill
      } catch (error) {
        reportSkillMutationError('install skill from zip', error)
        return null
      } finally {
        setInstallingKey(null)
      }
    },
    [invalidate]
  )

  const installFromDirectory = useCallback(
    async (directoryPath: string): Promise<InstalledSkill | null> => {
      setInstallingKey('directory')
      try {
        const skill = unwrapSkillResult(await window.api.skill.installFromDirectory({ directoryPath }))
        await refreshSkillsBestEffort(invalidate)
        return skill
      } catch (error) {
        reportSkillMutationError('install skill from directory', error)
        return null
      } finally {
        setInstallingKey(null)
      }
    },
    [invalidate]
  )

  const isInstalling = useCallback(
    (key?: string) => {
      if (!installingKey) return false
      if (!key) return !!installingKey
      return installingKey === key
    },
    [installingKey]
  )

  return { installingKey, isInstalling, install, installFromZip, installFromDirectory }
}
