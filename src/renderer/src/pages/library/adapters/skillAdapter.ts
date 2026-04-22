import type { ResourceAdapter, ResourceListResult } from './types'

// TODO(v2-data-layer): replace stub with useQuery('/skills') when Skill DataApi lands.
// Reference: no shared schema yet — Skill v2 migration tracked in a separate upstream PR.
// When upstream ships, swap this module to mirror `assistantAdapter.ts` and remove the stub DTO below.

export interface SkillStubDto {
  id: string
  name: string
  description?: string
  emoji?: string
  version?: string
  author?: string
  source?: string
  enabled?: boolean
  createdAt: string
  updatedAt: string
}

const EMPTY_LIST: SkillStubDto[] = []
const noop = () => {}

function useList(): ResourceListResult<SkillStubDto> {
  return {
    data: EMPTY_LIST,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: noop
  }
}

export const skillAdapter: ResourceAdapter<SkillStubDto> = {
  resource: 'skill',
  useList
}
