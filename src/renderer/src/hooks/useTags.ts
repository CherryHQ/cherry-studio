import { dataApiService } from '@data/DataApiService'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { Tag } from '@shared/data/types/tag'
import { useCallback } from 'react'

export interface TagListResult {
  tags: Tag[]
  isLoading: boolean
  error?: Error
  refetch: () => void
}

export interface CreateTagOptions {
  name: string
  color?: string | null
}

export interface UseTagsOptions {
  getDefaultColor?: () => string
}

export type EnsureTagInput = string | { name: string; color?: string | null }

export function useTagList(): TagListResult {
  const { data, isLoading, error, refetch } = useQuery('/tags')
  const stableRefetch = useCallback(() => {
    void refetch()
  }, [refetch])

  return {
    tags: Array.isArray(data) ? data : [],
    isLoading,
    error,
    refetch: stableRefetch
  }
}

/**
 * Resolve a list of tag names to Tag records, creating any that don't exist yet.
 *
 * Lookup order:
 *   1. Check the cached `useTagList` result (no extra request in the common path).
 *   2. Missing names -> POST /tags.
 *   3. If POST fails due to a unique-constraint race, do a one-shot imperative
 *      GET /tags and retry the lookup before bubbling up.
 *
 * Skips empty / whitespace-only names and de-duplicates input.
 *
 * `getDefaultColor` lets product surfaces keep their own visual defaulting
 * policy without making palette constants part of the generic tag data hook.
 */
export function useEnsureTags(options: UseTagsOptions = {}) {
  const { getDefaultColor } = options
  const { tags: cachedTags } = useTagList()
  const { trigger: createTrigger } = useMutation('POST', '/tags', {
    refresh: ['/tags']
  })

  const createTag = useCallback(
    ({ name, color }: CreateTagOptions): Promise<Tag> => {
      const resolvedColor = color ?? getDefaultColor?.()
      const body = resolvedColor ? { name: name.trim(), color: resolvedColor } : { name: name.trim() }
      return createTrigger({ body })
    },
    [createTrigger, getDefaultColor]
  )

  const ensureTags = useCallback(
    async (inputs: EnsureTagInput[]): Promise<Tag[]> => {
      const cleaned = Array.from(
        inputs
          .reduce<Map<string, { name: string; color?: string | null }>>((acc, input) => {
            const name = typeof input === 'string' ? input.trim() : input.name.trim()
            if (!name) return acc

            if (!acc.has(name)) {
              acc.set(name, {
                name,
                color: typeof input === 'string' ? undefined : input.color
              })
            }

            return acc
          }, new Map())
          .values()
      )

      if (cleaned.length === 0) return []

      const byName = (tags: Tag[]) => new Map(tags.map((t) => [t.name, t] as const))

      const existing = byName(cachedTags)
      const missing: { name: string; color?: string | null }[] = []
      const resolved: Tag[] = []

      for (const spec of cleaned) {
        const hit = existing.get(spec.name)
        if (hit) resolved.push(hit)
        else missing.push(spec)
      }

      if (missing.length === 0) return resolved

      for (const spec of missing) {
        try {
          const created = await createTag({
            name: spec.name,
            color: spec.color ?? undefined
          })
          resolved.push(created)
        } catch (e) {
          if (!(e instanceof DataApiError) || e.code !== ErrorCode.CONFLICT) throw e

          // Unique-constraint race: the reactive hook's snapshot won't reflect
          // the winner's insert until the next render, so pull fresh tags
          // imperatively for this one-shot lookup.
          const fresh = await dataApiService.get('/tags')
          const hit = Array.isArray(fresh) ? fresh.find((t) => t.name === spec.name) : undefined
          if (hit) {
            resolved.push(hit)
          } else {
            throw e
          }
        }
      }

      return resolved
    },
    [cachedTags, createTag]
  )

  return { ensureTags }
}
