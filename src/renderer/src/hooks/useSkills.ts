import { searchSkills } from '@renderer/services/SkillSearchService'
import type { InstalledSkill, SkillSearchResult } from '@types'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Hook to manage installed skills.
 *
 * Pass `agentId` to get per-agent enablement state and to scope toggle calls
 * to that agent. Without `agentId`, the hook returns the global skill library
 * with `isEnabled` forced to false — callers without an agent context (e.g.
 * the global Settings → Skills page) should rely on uninstall only.
 */
export function useInstalledSkills(agentId?: string) {
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.skill.list(agentId)
      if (result.success) {
        setSkills(result.data)
      } else {
        setError('Failed to load installed skills')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = useCallback(
    async (skillId: string, isEnabled: boolean) => {
      if (!agentId) {
        // Without an agent context there is nothing to toggle — per-agent
        // enablement has no target. Callers that want to toggle must scope
        // to an agent.
        return false
      }
      try {
        const result = await window.api.skill.toggle({ skillId, agentId, isEnabled })
        if (result.success) {
          await refresh()
        }
        return result.success
      } catch {
        return false
      }
    },
    [agentId, refresh]
  )

  const uninstall = useCallback(
    async (skillId: string) => {
      try {
        const result = await window.api.skill.uninstall(skillId)
        if (result.success) {
          await refresh()
        }
        return result.success
      } catch {
        return false
      }
    },
    [refresh]
  )

  return { skills, loading, error, refresh, toggle, uninstall }
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

  const install = useCallback(
    async (installSource: string): Promise<{ skill: InstalledSkill | null; error?: string }> => {
      setInstallingKey(installSource)
      try {
        const result = await window.api.skill.install({ installSource })
        if (result.success) {
          return { skill: result.data }
        }
        const errorMsg = result.error instanceof Error ? result.error.message : String(result.error ?? 'Unknown error')
        return { skill: null, error: errorMsg }
      } catch (err) {
        return { skill: null, error: err instanceof Error ? err.message : String(err) }
      } finally {
        setInstallingKey(null)
      }
    },
    []
  )

  const installFromZip = useCallback(async (zipFilePath: string): Promise<InstalledSkill | null> => {
    setInstallingKey('zip')
    try {
      const result = await window.api.skill.installFromZip({ zipFilePath })
      return result.success ? result.data : null
    } catch {
      return null
    } finally {
      setInstallingKey(null)
    }
  }, [])

  const installFromDirectory = useCallback(async (directoryPath: string): Promise<InstalledSkill | null> => {
    setInstallingKey('directory')
    try {
      const result = await window.api.skill.installFromDirectory({ directoryPath })
      return result.success ? result.data : null
    } catch {
      return null
    } finally {
      setInstallingKey(null)
    }
  }, [])

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
