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

export interface UseEnsureTagsOptions {
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
 * Resolve tag names to records, creating missing rows through DataApi.
 *
 * Empty names are skipped, duplicate names keep the first provided color, and
 * unique-constraint races do a one-shot imperative /tags read before rethrowing.
 */
export function useEnsureTags(options: UseEnsureTagsOptions = {}) {
  const { getDefaultColor } = options
  const { tags: cachedTags } = useTagList()
  const { trigger: createTag } = useMutation('POST', '/tags', {
    refresh: ['/tags']
  })

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

      const existingByName = new Map(cachedTags.map((tag) => [tag.name, tag] as const))
      const resolved: Tag[] = []
      const missing: Array<{ name: string; color?: string | null }> = []

      for (const spec of cleaned) {
        const existing = existingByName.get(spec.name)
        if (existing) {
          resolved.push(existing)
        } else {
          missing.push(spec)
        }
      }

      if (missing.length === 0) return resolved

      for (const spec of missing) {
        const color = spec.color ?? getDefaultColor?.()
        const body = color ? { name: spec.name, color } : { name: spec.name }

        try {
          resolved.push(await createTag({ body }))
        } catch (error) {
          if (!(error instanceof DataApiError) || error.code !== ErrorCode.CONFLICT) throw error

          const freshTags = await dataApiService.get('/tags')
          const freshHit = Array.isArray(freshTags) ? freshTags.find((tag) => tag.name === spec.name) : undefined
          if (!freshHit) throw error

          resolved.push(freshHit)
        }
      }

      return resolved
    },
    [cachedTags, createTag, getDefaultColor]
  )

  return { ensureTags }
}
