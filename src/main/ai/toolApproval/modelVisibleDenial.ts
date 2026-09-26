import type { DispatchDecision } from './ToolApprovalRegistry'

export function modelVisibleDenial(
  decision: Extract<DispatchDecision, { approved: false }>,
  toolName?: string
): string {
  if (decision.source === 'host') return decision.hostReason

  if (!decision.reason?.trim()) {
    return 'The user denied permission to use this tool. The tool did not execute. The user gave no reason and is waiting for your instructions.'
  }

  const prefix = `The user denied permission to use ${toolName ?? 'this tool'}. The tool did not execute.`
  let marker = '<<<USER_WORDS>>>'
  while (decision.reason.includes(marker)) marker = `<${marker}>`
  return `${prefix} The user's exact words are between these markers:\n${marker}\n${decision.reason}\n${marker}`
}
