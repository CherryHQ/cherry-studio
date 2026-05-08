import type { Tag } from '@shared/data/types/tag'

import type { ResourceType } from '../types'

export interface ResourceListQuery {
  /** Free-text match against name OR description (passed through to the API). */
  search?: string
  /** Union (OR) tag filter — kept if the resource is bound to ANY of these tag ids. */
  tagIds?: string[]
  limit?: number
  offset?: number
}

export interface ResourceListResult<TDto> {
  data: TDto[]
  isLoading: boolean
  isRefreshing: boolean
  error?: Error
  refetch: () => void
}

/**
 * List-only contract for resource adapters.
 * Per-adapter mutation hooks live alongside their list hook and are not part of
 * ResourceAdapter<TDto>.
 */
export interface ResourceAdapter<TDto> {
  readonly resource: ResourceType
  useList: (query?: ResourceListQuery) => ResourceListResult<TDto>
}

export interface TagListResult {
  tags: Tag[]
  isLoading: boolean
  error?: Error
  refetch: () => void
}

export interface EntityTagsResult extends TagListResult {
  supported: boolean
}
