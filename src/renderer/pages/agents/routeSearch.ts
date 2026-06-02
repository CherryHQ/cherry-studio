export const AGENTS_ROUTE = '/app/agents' as const
export const MESSAGE_VIEW = 'message' as const

export type AgentRouteSearch = {
  sessionId?: string
  view?: typeof MESSAGE_VIEW
}

export function buildAgentSessionMessageRouteUrl(sessionId: string): string {
  const params = new URLSearchParams({ sessionId, view: MESSAGE_VIEW })
  return `${AGENTS_ROUTE}?${params.toString()}`
}

/** Open a session as a normal agent tab (no focused message view). */
export function buildAgentSessionRouteUrl(sessionId: string): string {
  return `${AGENTS_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`
}

/** Extract the sessionId an agent tab points at, for cross-tab dedupe. */
export function getSessionIdFromUrl(url: string): string | undefined {
  try {
    return new URL(url, 'app://x').searchParams.get('sessionId') ?? undefined
  } catch {
    return undefined
  }
}

export function parseAgentRouteSearch(search: Record<string, unknown>): AgentRouteSearch {
  const sessionId = typeof search.sessionId === 'string' ? search.sessionId : undefined
  const view = search.view === MESSAGE_VIEW ? MESSAGE_VIEW : undefined

  return { sessionId, view }
}
