import type { ResourceAdapter, ResourceListResult } from './types'

// TODO(v2-data-layer): replace stub with useQuery('/agents') when Agent DataApi lands.
// Reference: no shared schema yet — Agent v2 migration tracked in a separate upstream PR.
// When upstream ships, swap this module to mirror `assistantAdapter.ts` and remove the stub DTO below.

export interface AgentStubDto {
  id: string
  name: string
  description?: string
  emoji?: string
  model?: string
  instructions?: string
  createdAt: string
  updatedAt: string
}

const EMPTY_LIST: AgentStubDto[] = []
const noop = async () => undefined

function useList(): ResourceListResult<AgentStubDto> {
  return {
    data: EMPTY_LIST,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: noop
  }
}

export const agentAdapter: ResourceAdapter<AgentStubDto> = {
  resource: 'agent',
  useList
}
