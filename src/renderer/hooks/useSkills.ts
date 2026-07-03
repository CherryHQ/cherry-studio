import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { searchSkills } from '@renderer/services/SkillSearchService'
import type { InstalledSkill, LocalSkill, SkillResult, SkillSearchResult } from '@shared/types/skill'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

function reportAndRethrowSkillMutationError(action: string, error: unknown): never {
  reportSkillMutationError(action, error)
  throw error instanceof Error ? error : new Error(skillErrorMessage(error))
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
        logger.warn('skill.toggle called without agentId; ignoring', { skillId, isEnabled })
        return false
      }
      try {
        const result = await window.api.skill.toggle({ agentId, skillId, isEnabled })
        const skill = unwrapSkillResult(result)
        if (!skill) throw new Error('Skill toggle returned no result')
        await refreshSkillsBestEffort(invalidate)
        return skill.isEnabled === isEnabled
      } catch (error) {
        reportAndRethrowSkillMutationError('toggle skill', error)
      }
    },
    [agentId, invalidate]
  )

  const uninstall = useCallback(
    async (skillId: string) => {
      try {
        const result = await window.api.skill.uninstall(skillId)
        unwrapSkillResult(result)
        await refreshSkillsBestEffort(invalidate)
        return true
      } catch (error) {
        reportAndRethrowSkillMutationError('uninstall skill', error)
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

function buildAvailableSkills(globalSkills: readonly InstalledSkill[], localSkills: readonly LocalSkill[]) {
  const seen = new Set<string>()
  const available: LocalSkill[] = []

  for (const skill of globalSkills) {
    if (!skill.isEnabled) continue
    seen.add(skill.folderName)
    available.push({
      name: skill.name,
      description: skill.description ?? undefined,
      filename: skill.folderName
    })
  }

  for (const skill of localSkills) {
    if (seen.has(skill.filename)) continue
    seen.add(skill.filename)
    available.push({
      name: skill.name,
      description: skill.description,
      filename: skill.filename
    })
  }

  return available
}

export function useAvailableSkills(agentId?: string, workdir?: string) {
  const installed = useInstalledSkills(agentId)
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const localRequestIdRef = useRef(0)
  const nextLocalRequestId = useCallback(() => {
    localRequestIdRef.current += 1
    return localRequestIdRef.current
  }, [])
  const invalidateLocalRequests = useCallback(() => {
    localRequestIdRef.current += 1
  }, [])

  const refreshLocalSkills = useCallback(async () => {
    const requestId = nextLocalRequestId()
    if (!workdir) {
      setLocalSkills([])
      setLocalError(null)
      setLocalLoading(false)
      return
    }

    setLocalLoading(true)
    setLocalError(null)

    try {
      const result = await window.api.skill.listLocal(workdir)
      const data = unwrapSkillResult(result)
      if (requestId === localRequestIdRef.current) setLocalSkills(data)
    } catch (error) {
      if (requestId !== localRequestIdRef.current) return
      const message = skillErrorMessage(error)
      setLocalSkills([])
      setLocalError(message)
      logger.warn('Failed to list local skills', { workdir, error: message })
    } finally {
      if (requestId === localRequestIdRef.current) setLocalLoading(false)
    }
  }, [nextLocalRequestId, workdir])

  useEffect(() => {
    void refreshLocalSkills()

    return invalidateLocalRequests
  }, [invalidateLocalRequests, refreshLocalSkills])

  const refreshInstalledSkills = installed.refresh
  const refresh = useCallback(async () => {
    await Promise.all([Promise.resolve(refreshInstalledSkills()), refreshLocalSkills()])
  }, [refreshInstalledSkills, refreshLocalSkills])

  const skills = useMemo(() => buildAvailableSkills(installed.skills, localSkills), [installed.skills, localSkills])

  return {
    skills,
    loading: installed.loading || localLoading,
    error: installed.error ?? localError,
    refresh
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
  const [installingCounts, setInstallingCounts] = useState<Map<string, number>>(() => new Map())
  const invalidate = useInvalidateCache()
  const installingKey = useMemo(() => installingCounts.keys().next().value ?? null, [installingCounts])

  const beginInstalling = useCallback((key: string) => {
    setInstallingCounts((current) => {
      const next = new Map(current)
      next.set(key, (next.get(key) ?? 0) + 1)
      return next
    })
  }, [])

  const finishInstalling = useCallback((key: string) => {
    setInstallingCounts((current) => {
      const count = current.get(key) ?? 0
      if (count <= 0) return current

      const next = new Map(current)
      if (count === 1) {
        next.delete(key)
      } else {
        next.set(key, count - 1)
      }
      return next
    })
  }, [])

  const install = useCallback(
    async (installSource: string): Promise<{ skill: InstalledSkill | null; error?: string }> => {
      beginInstalling(installSource)
      try {
        const skill = unwrapSkillResult(await window.api.skill.install({ installSource }))
        await refreshSkillsBestEffort(invalidate)
        return { skill }
      } catch (err) {
        return { skill: null, error: skillErrorMessage(err) }
      } finally {
        finishInstalling(installSource)
      }
    },
    [beginInstalling, finishInstalling, invalidate]
  )

  const installFromZip = useCallback(
    async (zipFilePath: string): Promise<InstalledSkill | null> => {
      beginInstalling('zip')
      try {
        const skill = unwrapSkillResult(await window.api.skill.installFromZip({ zipFilePath }))
        await refreshSkillsBestEffort(invalidate)
        return skill
      } catch (error) {
        reportAndRethrowSkillMutationError('install skill from zip', error)
      } finally {
        finishInstalling('zip')
      }
    },
    [beginInstalling, finishInstalling, invalidate]
  )

  const installFromDirectory = useCallback(
    async (directoryPath: string): Promise<InstalledSkill | null> => {
      beginInstalling('directory')
      try {
        const skill = unwrapSkillResult(await window.api.skill.installFromDirectory({ directoryPath }))
        await refreshSkillsBestEffort(invalidate)
        return skill
      } catch (error) {
        reportAndRethrowSkillMutationError('install skill from directory', error)
      } finally {
        finishInstalling('directory')
      }
    },
    [beginInstalling, finishInstalling, invalidate]
  )

  const isInstalling = useCallback(
    (key?: string) => {
      if (!key) return installingCounts.size > 0
      return installingCounts.has(key)
    },
    [installingCounts]
  )

  return { installingKey, isInstalling, install, installFromZip, installFromDirectory }
}
