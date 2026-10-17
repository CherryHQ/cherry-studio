import { createContext, type ReactElement, type ReactNode, use, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentLaunchIndex, getPartLaunchToolCallId, resolveResumeReceiptState } from '../shared/agentToolTypes'
import type { ToolResponseLike } from '../toolResponse'
import { buildResumeToolHeader } from './agentResumeHeader'

const AgentLaunchIndexContext = createContext<AgentLaunchIndex | null>(null)

/**
 * Provide the list-level launch-identity index so resume resolution is O(1) instead of
 * re-scanning the transcript per consumer during streaming. Unlike PartsContext, nested
 * boundaries never null this out — completed tool groups reset PartsContext to skip approval
 * checks, which would also hide any consumer that must see other messages' launch parts.
 */
/**
 * The Agent-owned resume presentation a host hands to shared components: which receipt heads its
 * group, and with which header. The policy lives here, next to the index it resolves against.
 */
export interface AgentResumePresentation {
  /** The header a resume receipt heads its group with, or undefined when it is not one. */
  renderResumeHeader: (toolResponse: ToolResponseLike, canNavigate: boolean) => ReactElement | undefined
}

const AgentResumePresentationContext = createContext<AgentResumePresentation | null>(null)

export function AgentLaunchIndexProvider({ value, children }: { value: AgentLaunchIndex | null; children: ReactNode }) {
  const { t } = useTranslation()
  const presentation = useMemo<AgentResumePresentation>(
    () => ({
      renderResumeHeader: (toolResponse, canNavigate) => {
        const state = resolveResumeReceiptState(
          toolResponse.response,
          getPartLaunchToolCallId(toolResponse),
          value,
          canNavigate
        )
        return state.kind === 'none' ? undefined : buildResumeToolHeader(state, toolResponse, t)?.header
      }
    }),
    [t, value]
  )
  return (
    <AgentLaunchIndexContext value={value}>
      <AgentResumePresentationContext value={presentation}>{children}</AgentResumePresentationContext>
    </AgentLaunchIndexContext>
  )
}

/** Read the list-level launch index (null when no provider is mounted). */
export function useAgentLaunchIndex() {
  return use(AgentLaunchIndexContext)
}

/** Read the host's resume presentation (null when the host mounts no Agent launch index). */
export function useAgentResumePresentation(): AgentResumePresentation | null {
  return use(AgentResumePresentationContext)
}
