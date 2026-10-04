/**
 * The sole exit for approval decisions' model-visible denial text. The question-tool predicate
 * from ./askUserQuestionToolName selects the ignored-question sentence; Claude Code guard rules
 * and remote interaction grouping use that same tool-name definition. Historical UI reasons
 * come from ./legacyDeniedReasons, while the local missing-reason branch covers clients without
 * a reason input box. Historical rows have no source flag to distinguish their UI fallback text.
 */
import { isAskUserQuestionToolName } from './askUserQuestionToolName'
import { isLegacySystemDenialReason } from './legacyDeniedReasons'
import type { DispatchDecision } from './ToolApprovalRegistry'

export function modelVisibleDenial(
  decision: Extract<DispatchDecision, { approved: false }>,
  toolName?: string
): string {
  if (decision.source === 'host') return decision.hostReason

  if (!decision.reason?.trim() || isLegacySystemDenialReason(decision.reason.trim())) {
    if (isAskUserQuestionToolName(toolName)) {
      return 'The user ignored this question without answering. The tool did not execute. The user is waiting for your instructions.'
    }
    return 'The user denied permission to use this tool. The tool did not execute. The user gave no reason and is waiting for your instructions.'
  }

  const prefix = `The user denied permission to use ${toolName ?? 'this tool'}. The tool did not execute.`
  let marker = '<<<USER_WORDS>>>'
  while (prefix.includes(marker) || decision.reason.includes(marker)) marker = `<${marker}>`
  return `${prefix} The user's exact words are between these markers:\n${marker}\n${decision.reason}\n${marker}`
}
