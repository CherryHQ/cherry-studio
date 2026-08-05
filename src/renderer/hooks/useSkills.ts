import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

const logger = loggerService.withContext('useSkills')

// Stable fallback while the /skills query is in flight. An inline `data ?? []`
// would change identity every render, and AgentComposer re-registers its skills
// launcher whenever the array changes — an infinite render loop during load.
const EMPTY_SKILLS: readonly InstalledSkill[] = Object.freeze([])

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

function logAndRethrowSkillMutationError(action: string, error: unknown): never {
  const message = skillErrorMessage(error)
  logger.error(`Failed to ${action}`, { error: message })
  throw error instanceof Error ? error : new Error(message)
}

async function refreshSkillsBestEffort(invalidate: ReturnType<typeof useInvalidateCache>): Promise<void> {
  try {
    await invalidate('/skills')
  } catch (error) {
    logger.warn('Failed to refresh skills cache after IPC mutation', { error })
  }
}

/**
 * Reconcile the on-disk skill library into the catalog once each time a skill view opens, then
 * refresh `/skills`. This is how skills an agent authored via native file tools (which never hit an
 * install route) surface without an app restart. Shared by every skill-list entry point — the
 * resource library and the agent edit dialog's Skills tab — so a skill becomes visible immediately
 * from wherever the user looks. Best-effort: a failure logs and resets so the next open retries,
 * and never blanks the list; the main process single-flights the actual reconcile.
 */
export function useReconcileSkillsOnOpen(enabled: boolean): void {
  const invalidate = useInvalidateCache()
  const reconciled = useRef(false)
  useEffect(() => {
    if (!enabled) {
      reconciled.current = false
      return
    }
    if (reconciled.current) return
    reconciled.current = true
    let cancelled = false
    ipcApi
      .request('skill.reconcile', {})
      .then(() => {
        // refreshSkillsBestEffort swallows its own errors, so fire-and-forget is safe here.
        if (!cancelled) void refreshSkillsBestEffort(invalidate)
      })
      .catch((error) => {
        // Reset so re-opening the view retries instead of staying stuck after one failure.
        reconciled.current = false
        logger.warn('Failed to reconcile skills on open', { error })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, invalidate])
}

/**
 * Hook to read installed skills.
 *
 * Pass `agentId` to get per-agent enablement state. Without `agentId`, the
 * hook returns the global skill library with `isEnabled` forced to false.
 * Per-agent enablement is edited through the agent form and saved via
 * PATCH /agents (see `AgentEditDialog`), not through this hook.
 * `loading` covers the initial fetch; `refreshing` reports background
 * revalidation separately so cached rows can remain visible while consumers
 * that initialize editable state wait for the authoritative projection.
 */
export function useInstalledSkills(agentId?: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled !== false
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/skills', {
    enabled,
    ...(agentId ? { query: { agentId } } : {})
  })
  const refresh = useCallback(async () => {
    await ipcApi.request('skill.reconcile', {})
    return refetch()
  }, [refetch])

  return {
    skills: data ?? (EMPTY_SKILLS as InstalledSkill[]),
    loading: isLoading,
    refreshing: isRefreshing,
    error: error?.message ?? null,
    refresh
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

export function useAvailableSkills(agentId?: string, workdir?: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true
  const installed = useInstalledSkills(agentId, { enabled })
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
    if (!enabled) {
      invalidateLocalRequests()
      setLocalSkills([])
      setLocalError(null)
      setLocalLoading(false)
      return
    }

    void refreshLocalSkills()

    return invalidateLocalRequests
  }, [enabled, invalidateLocalRequests, refreshLocalSkills])

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
        logAndRethrowSkillMutationError('install skill from zip', error)
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
        logAndRethrowSkillMutationError('install skill from directory', error)
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
