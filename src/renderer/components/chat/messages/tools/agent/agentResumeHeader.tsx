import type { ReactElement } from 'react'
import type { useTranslation } from 'react-i18next'

import { AgentToolsType, type ResumeReceiptState } from '../shared/agentToolTypes'
import { ToolHeader } from '../shared/GenericTools'
import type { ToolResponseLike } from '../toolResponse'

function getStringArg(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The presentation of a send-then-resume receipt — "continue handling" verb plus the launch
 * identity — shared by the chat row and the tool-group header so a resume reads exactly like the
 * launch card's continuation. Returns undefined when this receipt does not resolve to a launch.
 */
export function buildResumeToolHeader(
  state: Exclude<ResumeReceiptState, { kind: 'none' }>,
  toolResponse: ToolResponseLike,
  t: ReturnType<typeof useTranslation>['t']
): { header: ReactElement } | undefined {
  if (toolResponse.tool.name !== AgentToolsType.SendMessage) return undefined
  // The label serves the resolved identity; an unresolvable receipt never reaches here, so the
  // summary is only the fallback for hosts whose index carries no description.
  const identity =
    (state.kind === 'navigable' ? state.description : undefined) ?? getStringArg(toolResponse.arguments, 'summary')
  return {
    header: (
      <ToolHeader
        label={t('message.tools.activity.continueHandle')}
        toolName={toolResponse.tool.name}
        args={toolResponse.arguments}
        params={identity}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}
