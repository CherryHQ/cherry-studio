import type { JsonValue } from '@cherrystudio/agent-runtime'

import type { GateCall, GateFacts, HistoryEntry, PlanState } from '../facts'
import { BLOCK_REPEAT_AT, toolCallKey } from '../goal/goalState'
import type { ApprovalAnswer, ApprovalHostFacts, Attendance, PermissionMode } from '../hostFacts'

/** What the gate does with one call (D34): run it (perhaps with rewritten arguments), ask a person, or block it. */
export type ApprovalDecision =
  | { readonly kind: 'allow'; readonly args?: JsonValue }
  | { readonly kind: 'ask'; readonly presentation: 'stream' | 'message'; readonly args?: JsonValue }
  | { readonly kind: 'block'; readonly reason: string }

const REJECTED_HEADER =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (it did not run)."
export const UNATTENDED =
  'This unattended turn cannot request tool approval. Use bypassPermissions or retry interactively.'
const UNATTENDED_REQUIRED = 'This tool always requires user approval and cannot run unattended. Retry interactively.'
/** P3: global installs leak into every agent's environment, so they are blocked in every mode. */
const globalInstallReason = (summary: string): string =>
  `Blocked to avoid cross-agent dependency pollution: ${summary}. Install into the current project instead (e.g. \`bun install <pkg>\`, or \`uv run --with <pkg> python\`); for one-off tools use \`bun x <tool>\` / \`uvx <tool>\`.`
/** An `unavailable` answer: the host could reach nobody to decide. */
export const NOBODY_TO_APPROVE = 'Nobody can approve this tool call now.'
/** The turn stopped while a person was asked; the call never ran. */
export const ASK_WITHDRAWN = 'The approval request was withdrawn because the turn was stopped.'
export const REPEATED_CALL =
  'The same call has already been executed in this round and its result will not change; change approach or report the concrete blocker.'
export const PLAN_BLOCK =
  'Plan mode is read-only: this call would change something. Finish the plan, then call exit_plan_mode to ask the user to approve it.'

/** D35: the user's own words, set apart so the model never mistakes them for tool output. */
export const deniedReason = (feedback?: string): string => {
  const said = feedback?.trim()
  return said
    ? `${REJECTED_HEADER} To tell you how to proceed, the user said:\n${said}`
    : `${REJECTED_HEADER} Wait for the user's instructions instead of retrying it.`
}

/** Plan mode is the host's `plan` permission mode or an active `cherry.plan` record (PR-3d adds the tools that write it). */
export const planActive = (mode: PermissionMode, plan: PlanState | undefined): boolean =>
  mode === 'plan' || plan?.active === true
export function latestPlan(history: readonly HistoryEntry[]): PlanState | undefined {
  let plan: PlanState | undefined
  for (const entry of history) if (entry.kind === 'record' && entry.record.type === 'plan') plan = entry.record.value
  return plan
}

/** D8, block half (R4): the third identical call in a row within one goal round is blocked; nested calls are not counted. */
export function repeatBlock(call: GateCall, facts: GateFacts): string | undefined {
  if (!facts.goalRound || call.nested) return undefined
  const key = toolCallKey(call.tool, call.args)
  let count = 0
  for (let i = facts.callWindow.length - 1; i >= 0; i--) {
    if (toolCallKey(facts.callWindow[i].name, facts.callWindow[i].args) !== key) break
    count++
  }
  return count >= BLOCK_REPEAT_AT ? REPEATED_CALL : undefined
}

/** P7: whether `mode` asks a person for this call; `auto` stops only outside the allowed roots and for destructive shell. */
function requiresApproval(mode: PermissionMode, tool: string, host: ApprovalHostFacts): boolean {
  if (host.approvalRequired) return true
  if (host.category === 'meta') return false
  if (mode === 'auto') {
    if (tool === 'bash') return host.destructive
    if (host.category === 'read' || host.category === 'edit') return !host.withinAllowedRoots
    return false
  }
  if (host.category === 'read') return !host.withinAllowedRoots
  if (mode === 'acceptEdits' && host.category === 'edit') return !host.withinAllowedRoots
  // `default` and `plan` gate everything else (P13).
  return true
}

/**
 * D34, in the host's order (P1–P13): a disabled tool, a SQLite write or a global install is blocked in every mode; the
 * host's rewrite applies in every mode; full access skips approvals except for non-bypassable tools; auto-approved
 * tools run; otherwise the mode decides, and with nobody to ask the call is blocked. In plan mode (D37) a call that
 * edits or would need approval is blocked with a pointer to `exit_plan_mode`.
 */
export function decideApproval(
  call: GateCall,
  host: ApprovalHostFacts,
  mode: PermissionMode,
  attendance: Attendance,
  plan: PlanState | undefined
): ApprovalDecision {
  if (host.disabled) return { kind: 'block', reason: `Tool "${call.tool}" is disabled for this agent.` }
  if (host.sqliteGuard) return { kind: 'block', reason: host.sqliteGuard }
  if (host.globalInstall) return { kind: 'block', reason: globalInstallReason(host.globalInstall) }
  const rewritten = host.rewrittenArgs === undefined ? {} : { args: host.rewrittenArgs }
  const autoAllowed = host.autoApproved && !host.approvalRequired
  // Plan mode is read-only whatever the permission mode: what would ask in `default` is blocked too.
  if (
    planActive(mode, plan) &&
    (host.category === 'edit' || (!autoAllowed && requiresApproval('default', call.tool, host)))
  )
    return { kind: 'block', reason: PLAN_BLOCK }
  if (mode === 'bypassPermissions' && !host.nonBypassable) return { kind: 'allow', ...rewritten }
  if (autoAllowed || !requiresApproval(mode, call.tool, host)) return { kind: 'allow', ...rewritten }
  if (attendance === 'unavailable')
    return { kind: 'block', reason: host.approvalRequired ? UNATTENDED_REQUIRED : UNATTENDED }
  return { kind: 'ask', presentation: attendance === 'stream' ? 'stream' : 'message', ...rewritten }
}

/** D35: what the person's answer does to the call; memoized under `cherry.approval:<callKey>`. */
export function answerVerdict(
  answer: ApprovalAnswer,
  args: JsonValue | undefined
): { readonly block?: string; readonly args?: JsonValue } {
  if (answer.kind === 'denied') return { block: deniedReason(answer.feedback) }
  if (answer.kind === 'unavailable') return { block: NOBODY_TO_APPROVE }
  const edited = answer.args ?? args
  return edited === undefined ? {} : { args: edited }
}
