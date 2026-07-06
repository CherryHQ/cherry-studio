import type { ResourceType } from '@renderer/types/resourceCatalog'

export interface ResourceListQuery {
  enabled?: boolean
  /** Free-text match against name OR description (passed through to the API). */
  search?: string
  /** Backend tag-id filter transport shape; current assistant UI passes at most one id. */
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
