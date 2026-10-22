import type { ReactElement } from 'react'

import { AgentToolsType, type ResumeReceiptState } from '../shared/agentToolTypes'
import { ToolHeader } from '../shared/GenericTools'
import type { ToolResponseLike } from '../toolResponse'

function getStringArg(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The header a send-then-resume receipt heads its group with: the launch identity, or the request
 * summary when the launch is not loaded. Shared by the chat row and the tool-group header.
 * Returns undefined when this receipt resolves to no identity at all.
 */
export function buildResumeToolHeader(
  state: Exclude<ResumeReceiptState, { kind: 'none' }>,
  toolResponse: ToolResponseLike
): { header: ReactElement } | undefined {
  if (toolResponse.tool.name !== AgentToolsType.SendMessage) return undefined
  // An unresolvable receipt never reaches here, so the summary is the fallback for hosts whose
  // index carries no description.
  const identity =
    (state.kind === 'navigable' ? state.description : undefined) ?? getStringArg(toolResponse.arguments, 'summary')
  if (!identity) return undefined
  return {
    header: (
      <ToolHeader
        label={identity}
        toolName={toolResponse.tool.name}
        args={toolResponse.arguments}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}
