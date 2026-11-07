import { useCallback, useMemo } from 'react'

import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import type { UpdateEntityTagsDeltaDto } from '@shared/data/api/schemas/tags'
import type { EntityType } from '@shared/data/types/entityType'
import type { Tag } from '@shared/data/types/tag'

const EMPTY_TAGS: Tag[] = []

export interface UseEntityTagsOptions {
  enabled?: boolean
}

/** Tags of one entity type: the global tag list, each entity's bound tags, and inline tag mutations. */
export function useEntityTags(entityType: EntityType, options: UseEntityTagsOptions = {}) {
  const enabled = options.enabled ?? true
  const {
    data: tagsData,
    isLoading: isTagsLoading,
    error: tagsError,
    refetch: refetchTags
  } = useQuery('/tags', { enabled })
  const {
    data: bindingsData,
    isLoading: isBindingsLoading,
    error: bindingsError,
    refetch: refetchBindings
  } = useQuery('/entity-tags', { enabled, query: { entityType } })
  const { trigger: createTrigger } = useMutation('POST', '/tags', { refresh: ['/tags'] })
  const { trigger: syncTrigger } = useMutation('PUT', '/tags/entities/:entityType/:entityId', {
    refresh: ['/entity-tags']
  })
  const { trigger: deltaTrigger } = useMutation('PATCH', '/tags/entities/:entityType/:entityId', {
    refresh: ['/entity-tags']
  })

  // Mutations refresh only this window's SWR cache; another window's tag edits
  // arrive as data-change notifications. Refetch both read models: a binding
  // can reference a tag this window's catalog has not seen yet, and the join
  // below drops unknown tag ids.
  useDataChange(enabled ? ['/tags', '/entity-tags'] : [], () => {
    void refetchTags()
    void refetchBindings()
  })

  const tags = tagsData ?? EMPTY_TAGS
  const tagsByEntityId = useMemo(() => {
    const tagById = new Map(tags.map((tag) => [tag.id, tag] as const))
    const result = new Map<string, Tag[]>()
    for (const { entityId, tagId } of bindingsData ?? []) {
      const tag = tagById.get(tagId)
      if (!tag) continue
      const bound = result.get(entityId)
      if (bound) bound.push(tag)
      else result.set(entityId, [tag])
    }
    for (const bound of result.values()) bound.sort((a, b) => a.name.localeCompare(b.name))
    return result
  }, [bindingsData, tags])

  const createTag = useCallback(
    (name: string): Promise<Tag> => createTrigger({ body: { name: name.trim() } }),
    [createTrigger]
  )
  const syncEntityTags = useCallback(
    (entityId: string, tagIds: string[]): Promise<void> =>
      syncTrigger({ params: { entityType, entityId }, body: { tagIds } }).then(() => undefined),
    [entityType, syncTrigger]
  )
  const updateEntityTagsDelta = useCallback(
    (entityId: string, delta: UpdateEntityTagsDeltaDto): Promise<void> =>
      deltaTrigger({ params: { entityType, entityId }, body: delta }).then(() => undefined),
    [entityType, deltaTrigger]
  )
  const refetch = useCallback(() => Promise.all([refetchTags(), refetchBindings()]), [refetchBindings, refetchTags])

  return {
    tags,
    tagsByEntityId,
    isLoading: isTagsLoading || isBindingsLoading,
    error: tagsError ?? bindingsError,
    createTag,
    syncEntityTags,
    updateEntityTagsDelta,
    refetch,
    refetchBindings
  }
}
