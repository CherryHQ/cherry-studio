import { loggerService } from '@logger'
import { CacheService } from '@renderer/services/CacheService'
import * as z from 'zod'

const logger = loggerService.withContext('MarketplaceService')

const MARKETPLACE_BASE_URL = 'https://claude-plugins.dev'
const LIST_CACHE_TTL = 5 * 60 * 1000
const SEARCH_CACHE_TTL = 2 * 60 * 1000
const REQUEST_TIMEOUT_MS = 60000
const MAX_LIMIT = 100

export type MarketplaceSort = 'relevance' | 'stars' | 'downloads'

export interface MarketplaceListParams {
  limit?: number
  offset?: number
  query?: string
}

const pluginItemSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  namespace: z.string().optional(),
  gitUrl: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  keywords: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  category: z.string().nullable().optional(),
  stars: z.number().optional(),
  verified: z.boolean().optional(),
  downloads: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})

const pluginsResponseSchema = z.object({
  plugins: z.array(pluginItemSchema),
  total: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional()
})

const skillItemSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  namespace: z.string().optional(),
  sourceUrl: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  dependencies: z.array(z.string()).nullable().optional(),
  author: z.string().nullable().optional(),
  stars: z.number().optional(),
  installs: z.number().optional(),
  metadata: z
    .object({
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
      directoryPath: z.string().optional(),
      rawFileUrl: z.string().optional()
    })
    .optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})

const skillsResponseSchema = z.object({
  skills: z.array(skillItemSchema),
  total: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional()
})

export type MarketplacePlugin = z.infer<typeof pluginItemSchema>
export type MarketplaceSkill = z.infer<typeof skillItemSchema>

export interface MarketplacePage<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export type MarketplaceKind = 'plugin' | 'skill'

export interface MarketplacePager<T> {
  loadFirst: () => Promise<MarketplacePage<T>>
  loadMore: () => Promise<MarketplacePage<T>>
  reset: () => void
}

const buildCacheKey = (prefix: string, params: Record<string, unknown>): string => {
  const sorted = Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = params[key]
      return acc
    }, {})
  return `marketplace:${prefix}:${JSON.stringify(sorted)}`
}

/**
 * Create a response parser for marketplace API responses
 */
function createResponseParser<TItem>(
  schema: z.ZodObject<z.ZodRawShape>,
  itemsKey: string,
  logContext: string
): (payload: unknown) => { items: TItem[]; total: number } {
  return (payload: unknown) => {
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      logger.error(`Marketplace ${logContext} response parse failed`, parsed.error)
      return { items: [], total: 0 }
    }
    const data = parsed.data as Record<string, unknown>
    return { items: (data[itemsKey] ?? []) as TItem[], total: (data.total as number) ?? 0 }
  }
}

const parsePluginsResponse = createResponseParser<MarketplacePlugin>(pluginsResponseSchema, 'plugins', 'plugins')

const parseSkillsResponse = createResponseParser<MarketplaceSkill>(skillsResponseSchema, 'skills', 'skills')

const pendingRequests = new Map<string, Promise<MarketplacePage<MarketplacePlugin | MarketplaceSkill>>>()

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

const requestJson = async <T>(input: RequestInfo, init: RequestInit): Promise<T> => {
  const response = await withTimeout(fetch(input, init), REQUEST_TIMEOUT_MS)
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: 'Request failed' }))
    const message =
      typeof errorBody?.message === 'string'
        ? errorBody.message
        : `HTTP ${response.status}: ${response.statusText || 'Request failed'}`
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

const clampLimit = (limit: number | undefined): number => {
  if (!limit || Number.isNaN(limit)) return MAX_LIMIT
  return Math.min(Math.max(limit, 1), MAX_LIMIT)
}

const buildListUrl = (endpoint: 'plugins' | 'skills', params: MarketplaceListParams): string => {
  const url = new URL(`${MARKETPLACE_BASE_URL}/api/${endpoint}`)
  url.searchParams.set('limit', String(clampLimit(params.limit)))
  url.searchParams.set('offset', String(params.offset ?? 0))
  if (params.query) {
    url.searchParams.set('q', params.query)
  }
  return url.toString()
}

const fetchMarketplaceItems = async (
  endpoint: 'plugins' | 'skills',
  params: MarketplaceListParams
): Promise<MarketplacePage<MarketplacePlugin | MarketplaceSkill>> => {
  const cacheKey = buildCacheKey(endpoint, {
    limit: clampLimit(params.limit),
    offset: params.offset ?? 0,
    query: params.query ?? ''
  })
  const cached = CacheService.get<MarketplacePage<MarketplacePlugin | MarketplaceSkill>>(cacheKey)
  if (cached) {
    return cached
  }

  const existing = pendingRequests.get(cacheKey)
  if (existing) {
    return existing
  }

  const promise = (async () => {
    try {
      const response = await requestJson<unknown>(buildListUrl(endpoint, params), { method: 'GET' })
      const parsed = endpoint === 'plugins' ? parsePluginsResponse(response) : parseSkillsResponse(response)
      const limit = clampLimit(params.limit)
      const offset = params.offset ?? 0
      const page: MarketplacePage<MarketplacePlugin | MarketplaceSkill> = {
        items: parsed.items,
        total: parsed.total,
        limit,
        offset,
        hasMore: offset + parsed.items.length < parsed.total
      }
      const ttl = params.query ? SEARCH_CACHE_TTL : LIST_CACHE_TTL
      CacheService.set(cacheKey, page, ttl)
      return page
    } catch (error) {
      logger.error(`Marketplace ${endpoint} fetch failed`, error as Error, { query: params.query })
      throw error
    } finally {
      pendingRequests.delete(cacheKey)
    }
  })()

  pendingRequests.set(cacheKey, promise)
  return promise
}

export const fetchMarketplacePluginsPage = async (
  params: MarketplaceListParams
): Promise<MarketplacePage<MarketplacePlugin>> => {
  const page = await fetchMarketplaceItems('plugins', params)
  return page as MarketplacePage<MarketplacePlugin>
}

export const fetchMarketplaceSkillsPage = async (
  params: MarketplaceListParams
): Promise<MarketplacePage<MarketplaceSkill>> => {
  const page = await fetchMarketplaceItems('skills', params)
  return page as MarketplacePage<MarketplaceSkill>
}

export const createMarketplacePager = (options: {
  kind: MarketplaceKind
  limit?: number
  query?: string
}): MarketplacePager<MarketplacePlugin | MarketplaceSkill> => {
  const limit = clampLimit(options.limit)
  const query = options.query
  let nextOffset = 0
  let hasMore = true
  let requestId = 0
  let lastTotal = 0
  let prefetch: MarketplacePage<MarketplacePlugin | MarketplaceSkill> | null = null
  let prefetchPromise: Promise<void> | null = null

  const fetchPage = async (offset: number): Promise<MarketplacePage<MarketplacePlugin | MarketplaceSkill>> => {
    if (options.kind === 'plugin') {
      return await fetchMarketplacePluginsPage({ limit, offset, query })
    }
    return await fetchMarketplaceSkillsPage({ limit, offset, query })
  }

  const prefetchNext = async (offset: number) => {
    if (prefetchPromise || !hasMore) return
    const currentRequestId = requestId

    const promise = (async () => {
      try {
        const page = await fetchPage(offset)
        if (currentRequestId !== requestId) return
        prefetch = page
      } catch (error) {
        if (currentRequestId === requestId) {
          logger.warn('Marketplace prefetch failed', error as Error)
        }
      } finally {
        if (currentRequestId === requestId) {
          prefetchPromise = null
        }
      }
    })()

    prefetchPromise = promise
  }

  const applyPage = async (page: MarketplacePage<MarketplacePlugin | MarketplaceSkill>) => {
    nextOffset = page.offset + page.items.length
    hasMore = page.hasMore
    lastTotal = page.total
    prefetch = null

    if (page.hasMore) {
      prefetchNext(nextOffset)
    }

    return page
  }

  const reset = () => {
    requestId += 1
    nextOffset = 0
    hasMore = true
    prefetch = null
    prefetchPromise = null
  }

  const loadFirst = async () => {
    const page = await fetchPage(0)
    return await applyPage(page)
  }

  const loadMore = async () => {
    if (!hasMore) {
      return {
        items: [],
        total: lastTotal,
        limit,
        offset: nextOffset,
        hasMore: false
      }
    }

    if (prefetch && prefetch.offset === nextOffset) {
      const page = prefetch
      return await applyPage(page)
    }

    const page = await fetchPage(nextOffset)
    return await applyPage(page)
  }

  return { loadFirst, loadMore, reset }
}
