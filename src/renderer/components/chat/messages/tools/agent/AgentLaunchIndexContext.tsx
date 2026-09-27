import { createContext, type ReactNode, use } from 'react'

import type { AgentLaunchIndex } from '../shared/agentToolTypes'

const AgentLaunchIndexContext = createContext<AgentLaunchIndex | null>(null)

/**
 * Provide the list-level launch-identity index so resume resolution is O(1) instead of
 * re-scanning the transcript per consumer during streaming. Unlike PartsContext, nested
 * boundaries never null this out — completed tool groups reset PartsContext to skip approval
 * checks, which would also hide any consumer that must see other messages' launch parts.
 */
export function AgentLaunchIndexProvider({ value, children }: { value: AgentLaunchIndex | null; children: ReactNode }) {
  return <AgentLaunchIndexContext value={value}>{children}</AgentLaunchIndexContext>
}

/** Read the list-level launch index (null when no provider is mounted). */
export function useAgentLaunchIndex() {
  return use(AgentLaunchIndexContext)
}
