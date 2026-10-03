import { createContext, use } from 'react'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import type { AgentPreviewUrlCandidate } from './agentRightPaneProjection'

export interface AgentRightPaneRuntime {
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  /** Pages older history in so a flow root outside the loaded window can still be opened. */
  loadOlder?: () => void
  /** Whether older history remains; false means a missing root cannot be paged in. */
  hasOlder?: boolean
  /** The failure of the last older-history fetch, so a chase that cannot finish can report it. */
  loadOlderError?: Error
  browserUrl: string | null
  browserProfile:
    | typeof WebviewSecurityProfile.AgentBrowser
    | typeof WebviewSecurityProfile.AgentDevPreview
    | typeof WebviewSecurityProfile.AgentHtmlArtifact
  openBrowserUrl: (url: string) => void
  acceptDetectedBrowserUrl: (url: string | null, source: AgentPreviewUrlCandidate | null) => void
}

/** The pane's runtime slice, published by the scope so actions and panels read the same snapshot. */
export const AgentRightPaneRuntimeContext = createContext<AgentRightPaneRuntime | null>(null)

export function useAgentRightPaneRuntime(): AgentRightPaneRuntime {
  const value = use(AgentRightPaneRuntimeContext)
  if (!value) throw new Error('useAgentRightPaneRuntime must be used within <AgentRightPane.Scope>')
  return value
}
