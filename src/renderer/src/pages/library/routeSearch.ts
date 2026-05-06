import type { ResourceType } from './types'

export const LIBRARY_ROUTE = '/app/library' as const

export type LibraryRouteAction = 'create' | 'edit'

export type LibraryRouteSearch = {
  resourceType?: ResourceType
  action?: LibraryRouteAction
  id?: string
}

const RESOURCE_TYPES = new Set<ResourceType>(['agent', 'assistant', 'skill'])
const ROUTE_ACTIONS = new Set<LibraryRouteAction>(['create', 'edit'])

export function buildLibraryListSearch(resourceType?: ResourceType): LibraryRouteSearch {
  return resourceType ? { resourceType } : {}
}

export function buildLibraryCreateSearch(resourceType: ResourceType): LibraryRouteSearch {
  return { resourceType, action: 'create' }
}

export function buildLibraryEditSearch(resourceType: ResourceType, id: string): LibraryRouteSearch {
  return { resourceType, action: 'edit', id }
}

export function buildLibraryRouteUrl(search: LibraryRouteSearch): string {
  const params = new URLSearchParams()
  if (search.resourceType) params.set('resourceType', search.resourceType)
  if (search.action) params.set('action', search.action)
  if (search.id) params.set('id', search.id)

  const query = params.toString()
  return query ? `${LIBRARY_ROUTE}?${query}` : LIBRARY_ROUTE
}

export function parseLibraryRouteSearch(search: Record<string, unknown>): LibraryRouteSearch {
  const resourceType = typeof search.resourceType === 'string' ? search.resourceType : undefined
  const action = typeof search.action === 'string' ? search.action : undefined
  const id = typeof search.id === 'string' ? search.id : undefined

  return {
    resourceType:
      resourceType && RESOURCE_TYPES.has(resourceType as ResourceType) ? (resourceType as ResourceType) : undefined,
    action: action && ROUTE_ACTIONS.has(action as LibraryRouteAction) ? (action as LibraryRouteAction) : undefined,
    id
  }
}
