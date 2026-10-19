import type { RunEndFacts, SubagentRunRecord, SubagentStopper } from '../facts'
import type { PendingResult } from './subagentLedger'

/** Model requests one child run may make, compaction summaries included (README subagents; Claude Code's fork limit). */
export const MAX_SUBAGENT_REQUESTS = 200
/** Background children one parent may run at once unless the user sets another cap; the host's `Settings` default. */
export const DEFAULT_MAX_BACKGROUND = 20
/** Ids listed in status messages and errors. */
const LISTED = 20

export const IN_SUBAGENT = 'Subagents cannot start or manage subagents.'
const PREAMBLE =
  'You are a subagent working for another agent, not for the user. Do the task below with your tools, then finish with one final message that reports the result in full — the other agent sees only that final message. You cannot ask the user questions and you cannot start subagents.'
const NO_FINAL_MESSAGE = 'The subagent finished without a final message.'
export const RECOVERY_HINT =
  'Your previous run was interrupted. Check the current state of the workspace first and do not redo work that is already done.'
export const FORK_WITH_MODEL =
  "A fork shares this conversation's prompt cache and must use the current model; drop model or fork."
const STOPPED: { readonly [end in Exclude<RunEndFacts['outcome'], 'completed'>]: string } = {
  failed: 'The subagent failed',
  truncated: 'The subagent hit its output limit before finishing',
  aborted: 'The subagent was stopped because the turn was aborted',
  limit_reached: `The subagent was stopped after ${MAX_SUBAGENT_REQUESTS} model requests`
}
const STOPPED_BY: { readonly [by in SubagentStopper]: string } = {
  model: 'stopped by you',
  user: 'stopped by the user',
  budget: "stopped because the goal's budget is used up"
}

export const taskText = (prompt: string) => `${PREAMBLE}\n\nTask:\n${prompt}`
export const idTrailer = (child: string) => `(id: ${child} — continue this subagent with message_subagent.)`
export const startedText = (child: string) =>
  `Subagent started in the background (id: ${child}). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`
/** The reply to a continuation; `child` differs from `from` when the old id now forwards to a forked child (S-j). */
export const continuedText = (from: string, child: string) =>
  from === child
    ? `Subagent ${child} resumed in the background with your message; you will be notified when it finishes.`
    : `Subagent ${from} continues as ${child} in the background with your message; use id ${child} from now on. You will be notified when it finishes.`
export const queuedText = (child: string) => `Message queued for subagent ${child}; it reads it after its current step.`
export const capText = (running: number) =>
  `${running} background subagents are already running; wait for one to finish before starting another.`

/** What a run's end says, as the tool result of a foreground run (L4). */
export type RunReport = { readonly report?: string; readonly reason?: string; readonly partial?: string }
/** The parts of a run's end the records keep: the final message, or the error and last partial output. */
export function runReport(answer: RunEndFacts): RunReport {
  if (answer.outcome === 'completed') return { report: answer.text.trim() }
  const partial = answer.text.trim()
  return { ...(answer.error ? { reason: answer.error } : {}), ...(partial ? { partial } : {}) }
}
export function runText(outcome: RunEndFacts['outcome'], report: RunReport): string {
  if (outcome === 'completed') return report.report || NO_FINAL_MESSAGE
  const lines = [report.reason ? `${STOPPED[outcome]}: ${report.reason}` : `${STOPPED[outcome]}.`]
  if (report.partial) lines.push(`Partial output before it stopped:\n${report.partial}`)
  return lines.join('\n')
}
export const stoppedText = (child: string, partial: string | undefined) =>
  partial ? `Stopped subagent ${child}. Partial output before it stopped:\n${partial}` : `Stopped subagent ${child}.`

/** A child's state in the words lists of subagents use. */
export function statusText(record: SubagentRunRecord, live: boolean, awaiting: boolean): string {
  if (live) return awaiting ? 'waiting for a tool approval' : 'running'
  return record.stoppedBy ? STOPPED_BY[record.stoppedBy] : (record.outcome ?? 'finished')
}
export function unknownIdText(id: string, listed: readonly string[]): string {
  const head = `No subagent with id ${id} in this conversation.`
  return listed.length === 0 ? head : [`${head} Subagents you can address:`, ...listed.slice(0, LISTED)].join('\n')
}

const HEADER = 'Background subagent update (automatic message, not from the user):'
const indent = (text: string) =>
  text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
function itemText(item: PendingResult): string {
  const head = `- "${item.description}" (id: ${item.sessionId})`
  const partial = item.partial ? `\n  Partial output before it stopped:\n${indent(item.partial)}` : ''
  switch (item.outcome ?? 'interrupted') {
    case 'completed':
      return `${head} completed:\n${indent(item.report || NO_FINAL_MESSAGE)}`
    case 'failed':
      return `${head} failed${item.reason ? `: ${item.reason}` : '.'}${partial}`
    case 'truncated':
      return `${head} hit its output limit before finishing.${partial}`
    case 'limit_reached':
      return `${head} was stopped after ${MAX_SUBAGENT_REQUESTS} model requests.${partial}`
    case 'aborted':
      return `${head} was aborted.${partial}`
    case 'interrupted':
      return `${head} was interrupted (the app closed while it was running). Continue it with message_subagent if the work is still needed.`
    case 'stopped':
      return item.stoppedBy === 'user'
        ? `${head} was stopped by the user.`
        : `${head} was stopped because the goal's budget is used up.${partial}`
  }
}
/** One message for every pending result, oldest first (README subagents: results that end together merge). */
export function notificationText(items: readonly PendingResult[], othersRunning: number): string {
  const footer =
    othersRunning === 0
      ? []
      : [
          '',
          `${othersRunning} other background ${othersRunning === 1 ? 'subagent is' : 'subagents are'} still running.`
        ]
  return [HEADER, '', ...items.map(itemText), ...footer].join('\n')
}

const STATUS_HEADER = 'Background subagent status (automatic message, not from the user):'
const STATUS_FOOTER =
  'Running subagents report back on their own when they finish: do not start them again, and do not wait for or poll them.'
/** The status a compaction leaves (D26, S20); `undefined` when there is nothing to list. */
export function statusMessage(
  running: readonly { readonly record: SubagentRunRecord; readonly awaiting: boolean }[],
  pending: readonly PendingResult[]
): string | undefined {
  const lines = [
    ...running.map(
      ({ record, awaiting }) =>
        `- "${record.description}" (id: ${record.sessionId}): ${awaiting ? 'waiting for a tool approval' : 'running'}`
    ),
    ...pending.map(
      (item) => `- "${item.description}" (id: ${item.sessionId}): finished; its result comes with the next update`
    )
  ].slice(0, LISTED)
  return lines.length === 0 ? undefined : [STATUS_HEADER, ...lines, STATUS_FOOTER].join('\n')
}
