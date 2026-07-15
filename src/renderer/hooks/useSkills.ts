import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { searchSkills } from '@renderer/utils/skillSearch'
import type {
  InstalledSkill,
  LocalSkill,
  SkillResult,
  SkillSearchResult,
  SystemSkillCandidate
} from '@shared/types/skill'
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
  toast.error(message)
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
 * Pass `agentId` to get per-agent enablement state. Without `agentId`, the
 * hook returns the global skill library with `isEnabled` forced to false.
 * Per-agent enablement is edited through the agent form and saved via
 * PATCH /agents (see `AgentEditDialog`), not through this hook.
 */
export function useInstalledSkills(agentId?: string, options: { enabled?: boolean } = {}) {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/skills', {
    enabled: options.enabled !== false,
    ...(agentId ? { query: { agentId } } : {})
  })
  const invalidate = useInvalidateCache()

  const uninstall = useCallback(
    async (skillId: string) => {
      try {
        const result = await ipcApi.request('skill.uninstall', { skillId })
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
      const result = await ipcApi.request('skill.list_local', { workdir })
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

/** Discover and import skills from known system-level CLI directories. */
export function useSystemSkills(enabled = true) {
  const [skills, setSkills] = useState<SystemSkillCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState<Set<string>>(() => new Set())
  const importingRef = useRef<Set<string>>(new Set())
  const invalidate = useInvalidateCache()
  const requestIdRef = useRef(0)

  const discover = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!enabled) {
      setSkills([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const discovered = await ipcApi.request('skill.discover_system', {})
      if (requestId === requestIdRef.current) setSkills(discovered)
    } catch (cause) {
      if (requestId !== requestIdRef.current) return
      const message = skillErrorMessage(cause)
      setSkills([])
      setError(message)
      logger.warn('Failed to discover system skills', { error: message })
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void discover()
    return () => {
      requestIdRef.current += 1
    }
  }, [discover])

  const importSkill = useCallback(
    async (skill: SystemSkillCandidate): Promise<InstalledSkill | null> => {
      if (skill.status !== 'available') return null
      if (importingRef.current.has(skill.id)) return null
      importingRef.current.add(skill.id)
      setImporting((current) => new Set(current).add(skill.id))
      try {
        const installed = await ipcApi.request('skill.import_system', { directoryPath: skill.directoryPath })
        await refreshSkillsBestEffort(invalidate)
        await discover()
        return installed
      } catch (cause) {
        await discover()
        reportSkillMutationError('import system skill', cause)
        return null
      } finally {
        importingRef.current.delete(skill.id)
        setImporting((current) => {
          const next = new Set(current)
          next.delete(skill.id)
          return next
        })
      }
    },
    [discover, invalidate]
  )

  return { skills, loading, error, importSkill, importing }
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
        const skill = unwrapSkillResult(await ipcApi.request('skill.install', { installSource }))
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
        const skill = unwrapSkillResult(await ipcApi.request('skill.install_from_zip', { zipFilePath }))
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
        const skill = unwrapSkillResult(await ipcApi.request('skill.install_from_directory', { directoryPath }))
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
