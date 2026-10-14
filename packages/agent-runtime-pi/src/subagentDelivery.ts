import type { Usage } from '@earendil-works/pi-ai'
import type { AgentBeforeSettleEvent, AgentBeforeSettleEventResult } from '@earendil-works/pi-coding-agent'

import { type ToolOutputOffload, offloadText } from './offload'
import type { SubagentOutcome, SubagentStopper } from './subagent'
import { MAX_SUBAGENT_REQUESTS, type RunResult } from './subagentRun'

/** Custom message of the parent carrying finished background runs; the model gets it as a user message. */
export const SUBAGENT_NOTIFICATION_TYPE = 'cherry.subagent-notification'

/** Results longer than this many characters are shortened when the host has no offload store. */
export const NOTIFICATION_THRESHOLD_CHARS = 20_000

/** `details` of a notification: for the host's rendering and the goal's accounting, never sent to the model. */
export interface SubagentNotificationDetails {
  subagents: Array<{
    sessionId: string
    run: number
    outcome: SubagentOutcome
    stoppedBy?: SubagentStopper
    usage: Usage
  }>
}

/** One finished run waiting to reach the parent. */
export interface PendingDelivery {
  sessionId: string
  run: number
  description: string
  outcome: SubagentOutcome
  stoppedBy?: SubagentStopper
  report?: string
  reason?: string
  partial?: string
  usage: Usage
  /** False for a run the parent only needs to hear of: it rides with the next message, never starts one. */
  wake: boolean
}

export interface NotificationMessage {
  customType: typeof SUBAGENT_NOTIFICATION_TYPE
  content: string
  display: false
  details: SubagentNotificationDetails
}

/** What delivery needs from the parent session. */
export interface DeliveryHost {
  /** `pi.sendMessage(message, { triggerTurn: true })`. */
  startTurn(message: NotificationMessage): void
  /** The parent runs nothing and compacts nothing. */
  isIdle(): boolean
  /** Background subagents of the parent still running or awaiting approval. */
  stillRunning(): number
}

const HEADER = 'Background subagent update (automatic message, not from the user):'
const NO_FINAL_MESSAGE = 'The subagent finished without a final message.'
// Without a store the model cannot read the rest back, so it keeps more than the offload excerpts.
const KEPT_HEAD_CHARS = 8_000
const KEPT_TAIL_CHARS = 8_000

const indent = (text: string) =>
  text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')

function keepEnds(text: string): string {
  if (text.length <= NOTIFICATION_THRESHOLD_CHARS) return text
  const omitted = text.length - KEPT_HEAD_CHARS - KEPT_TAIL_CHARS
  return `${text.slice(0, KEPT_HEAD_CHARS)}\n[… ${omitted} characters left out …]\n${text.slice(-KEPT_TAIL_CHARS)}`
}

/**
 * Shortens a finished run's report and partial output for the notification: through the host's
 * offload store when there is one, otherwise by keeping the head and tail.
 */
export async function shortenResult(
  result: RunResult,
  offload: ToolOutputOffload | undefined,
  origin: { toolCallId: string; toolName: string }
): Promise<RunResult> {
  const shorten = async (text: string | undefined) => {
    if (text === undefined) return undefined
    if (!offload) return keepEnds(text)
    return (await offloadText(offload, text, origin)) ?? text
  }
  const [report, partial] = await Promise.all([shorten(result.report), shorten(result.partial)])
  return {
    ...result,
    ...(report === undefined ? {} : { report }),
    ...(partial === undefined ? {} : { partial })
  }
}

function itemText(item: PendingDelivery): string {
  const head = `- "${item.description}" (id: ${item.sessionId})`
  const partial = item.partial ? `\n  Partial output before it stopped:\n${indent(item.partial)}` : ''
  switch (item.outcome) {
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

/** One message for every pending item, oldest first. */
export function renderNotification(items: readonly PendingDelivery[], stillRunning: number): NotificationMessage {
  const footer =
    stillRunning === 0
      ? []
      : ['', `${stillRunning} other background ${stillRunning === 1 ? 'subagent is' : 'subagents are'} still running.`]
  return {
    customType: SUBAGENT_NOTIFICATION_TYPE,
    content: [HEADER, '', ...items.map(itemText), ...footer].join('\n'),
    display: false,
    details: {
      subagents: items.map((item) => ({
        sessionId: item.sessionId,
        run: item.run,
        outcome: item.outcome,
        ...(item.stoppedBy === undefined ? {} : { stoppedBy: item.stoppedBy }),
        usage: item.usage
      }))
    }
  }
}

/**
 * When finished background runs reach the parent: merged into a run as it settles, or as the start
 * of a new run once the parent is idle, never in the middle of a run.
 */
export class SubagentDelivery {
  private queue: PendingDelivery[] = []
  /** Host prompts and compactions in flight: Pi's `prompt()` reports idle while it prepares. */
  private holds = 0
  /** After the user stops a turn, nothing starts until they speak again. */
  private suppressed = false
  private closed = false

  constructor(private readonly host: DeliveryHost) {}

  enqueue(item: PendingDelivery): void {
    this.queue.push(item)
    this.deliverIfIdle()
  }

  /** `agent_before_settle`: the run goes on with the notification instead of settling. */
  beforeSettle(event: AgentBeforeSettleEvent): AgentBeforeSettleEventResult | undefined {
    // A request the host aborted through its own signal settles here, not as an aborted run.
    if (event.outcome === 'aborted') this.suppressed = true
    if (event.outcome !== 'completed') return undefined
    // Users first: their queued message is answered before the notification is merged.
    if (event.context.pendingMessages.some((message) => message.role === 'user')) return undefined
    if (!this.queue.some((item) => item.wake)) return undefined
    return { entries: [...event.entries, { type: 'custom_message', ...this.take() }], continue: true }
  }

  settled(aborted: boolean): void {
    if (aborted) this.suppressed = true
    else this.deliverIfIdle()
  }

  /** `before_agent_start`, a prompt about to run: everything still queued rides with it. */
  beforeAgentStart(): { message: NotificationMessage } | undefined {
    this.suppressed = false
    return this.queue.length === 0 ? undefined : { message: this.take() }
  }

  /** Held by the host's prompt or compaction until it returns. */
  hold(): () => void {
    this.holds++
    let held = true
    return () => {
      if (!held) return
      held = false
      this.holds--
      this.deliverIfIdle()
    }
  }

  close(): void {
    this.closed = true
  }

  private deliverIfIdle(): void {
    if (this.closed || this.holds > 0 || this.suppressed || !this.host.isIdle()) return
    if (!this.queue.some((item) => item.wake)) return
    this.host.startTurn(this.take())
  }

  private take(): NotificationMessage {
    const items = this.queue
    this.queue = []
    return renderNotification(items, this.host.stillRunning())
  }
}
