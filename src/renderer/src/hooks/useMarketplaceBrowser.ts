import { loggerService } from '@logger'
import {
  createMarketplacePager,
  type MarketplacePlugin,
  type MarketplaceSkill,
  type MarketplaceSort
} from '@renderer/services/MarketplaceService'
import type { PluginMetadata } from '@renderer/types/plugin'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useMarketplaceBrowser')

export type MarketplaceKind = 'plugin' | 'skill'

export interface MarketplaceEntry {
  metadata: PluginMetadata
  stats: {
    stars: number
    downloads: number
  }
}

export interface UseMarketplaceBrowserOptions {
  kind: MarketplaceKind
  query: string
  sort: MarketplaceSort
  limit?: number
}

const DEFAULT_PAGE_SIZE = 40

const sanitizeIdentifier = (value: string): string => {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return sanitized || 'marketplace-item'
}

const mapPluginToEntry = (item: MarketplacePlugin): MarketplaceEntry => {
  const baseId = sanitizeIdentifier(item.name)
  const sourceKey = item.namespace ? `${item.namespace}/${item.name}` : item.name
  const sourcePath = `marketplace:plugin:${sourceKey}`
  const version = item.version ?? undefined

  return {
    metadata: {
      sourcePath,
      filename: `${baseId}.md`,
      name: item.name,
      description: item.description ?? undefined,
      category: item.category ?? 'plugins',
      type: 'agent',
      tags: item.keywords && item.keywords.length > 0 ? item.keywords : undefined,
      version,
      author: item.author ?? undefined,
      size: 0,
      contentHash: item.id ?? `${sourcePath}:${version ?? ''}`
    },
    stats: {
      stars: item.stars ?? 0,
      downloads: item.downloads ?? 0
    }
  }
}

/**
 * Build source key for skill installation API
 * Format: "owner/repo/skillName" for the /api/skills/{owner}/{repo}/{skillName} endpoint
 */
const buildSkillSourceKey = (item: MarketplaceSkill): string => {
  const { name, namespace, metadata } = item
  const repoOwner = metadata?.repoOwner
  const repoName = metadata?.repoName

  // Best case: explicit owner/repo from metadata
  if (repoOwner && repoName) {
    return `${repoOwner}/${repoName}/${name}`
  }

  // Fallback: parse from namespace
  if (namespace) {
    const cleanNamespace = namespace.replace(/^@/, '')
    const parts = cleanNamespace.split('/').filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}/${name}`
    }
    return `${cleanNamespace}/${name}`
  }

  return name
}

const mapSkillToEntry = (item: MarketplaceSkill): MarketplaceEntry => {
  const baseId = sanitizeIdentifier(item.name)
  const sourceKey = buildSkillSourceKey(item)
  const sourcePath = `marketplace:skill:${sourceKey}`

  logger.debug('mapSkillToEntry', {
    name: item.name,
    namespace: item.namespace,
    repoOwner: item.metadata?.repoOwner,
    repoName: item.metadata?.repoName,
    sourceKey,
    sourcePath
  })

  const version = item.version ?? undefined

  return {
    metadata: {
      sourcePath,
      filename: baseId,
      name: item.name,
      description: item.description ?? undefined,
      category: 'skills',
      type: 'skill',
      tags: undefined,
      version,
      author: item.author ?? undefined,
      size: 0,
      contentHash: item.id ?? `${sourcePath}:${version ?? ''}`
    },
    stats: {
      stars: item.stars ?? 0,
      downloads: item.installs ?? 0
    }
  }
}

const sortEntries = (entries: MarketplaceEntry[], sort: MarketplaceSort): MarketplaceEntry[] => {
  if (sort === 'relevance') return entries
  const field = sort === 'stars' ? 'stars' : 'downloads'
  return [...entries].sort((a, b) => {
    const diff = (b.stats[field] ?? 0) - (a.stats[field] ?? 0)
    if (diff !== 0) return diff
    return a.metadata.name.localeCompare(b.metadata.name)
  })
}

export const useMarketplaceBrowser = ({ kind, query, sort, limit }: UseMarketplaceBrowserOptions) => {
  const [entries, setEntries] = useState<MarketplaceEntry[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const pageSize = limit ?? DEFAULT_PAGE_SIZE
  const normalizedQuery = query.trim()
  const requestQuery = normalizedQuery.length > 0 ? normalizedQuery : undefined

  const pager = useMemo(
    () => createMarketplacePager({ kind, limit: pageSize, query: requestQuery }),
    [kind, pageSize, requestQuery]
  )

  const mapEntries = useCallback(
    (items: Array<MarketplacePlugin | MarketplaceSkill>): MarketplaceEntry[] =>
      items.map((item) =>
        kind === 'plugin' ? mapPluginToEntry(item as MarketplacePlugin) : mapSkillToEntry(item as MarketplaceSkill)
      ),
    [kind]
  )

  /**
   * Shared helper to reset state and load the first page
   */
  const loadFirstPage = useCallback(() => {
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    setEntries([])
    setTotal(0)
    setHasMore(true)
    setError(null)
    setIsLoading(true)
    pager.reset()

    pager
      .loadFirst()
      .then((page) => {
        if (requestId !== requestIdRef.current) return
        const nextEntries = mapEntries(page.items)
        setEntries(nextEntries)
        setTotal(page.total)
        setHasMore(page.hasMore)
      })
      .catch((fetchError) => {
        if (requestId === requestIdRef.current) {
          const message = fetchError instanceof Error ? fetchError.message : 'Failed to load marketplace data'
          logger.error('Marketplace fetch failed', fetchError as Error)
          setError(message)
          setHasMore(false)
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setIsLoading(false)
        }
      })
  }, [mapEntries, pager])

  useEffect(() => {
    loadFirstPage()
  }, [loadFirstPage])

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || !hasMore) return
    const requestId = requestIdRef.current
    setIsLoadingMore(true)
    setError(null)

    pager
      .loadMore()
      .then((page) => {
        if (requestId !== requestIdRef.current) return
        const nextEntries = mapEntries(page.items)
        setEntries((prev) => [...prev, ...nextEntries])
        setTotal(page.total)
        setHasMore(page.hasMore)
      })
      .catch((fetchError) => {
        if (requestId === requestIdRef.current) {
          const message = fetchError instanceof Error ? fetchError.message : 'Failed to load marketplace data'
          logger.error('Marketplace fetch failed', fetchError as Error)
          setError(message)
          // Keep hasMore true so user can retry loading more
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setIsLoadingMore(false)
        }
      })
  }, [hasMore, isLoading, isLoadingMore, mapEntries, pager])

  const sortedEntries = useMemo(() => sortEntries(entries, sort), [entries, sort])

  return {
    entries: sortedEntries,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    refetch: loadFirstPage
  }
}
