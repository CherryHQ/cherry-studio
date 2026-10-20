import type { MessageEndEvent, TurnEndEvent } from '@earendil-works/pi-coding-agent'

import {
  INTERRUPTED_CALL_RESULT,
  type MessageResult,
  type RetractResult,
  type RunEndFacts,
  type StartResult,
  type TurnInput
} from '@cherrystudio/agent-behavior'

import {
  addUsage,
  historyOf,
  keyOf,
  keysOf,
  resultFor,
  textOf,
  unansweredCalls,
  usageFact,
  ZERO_USAGE
} from './history'
import {
  type Adapter,
  type Conversation,
  markerMessage,
  piIdle,
  type RunEnding,
  type RunState,
  waitFor,
  wake
} from './state'

/** H2 admission: a known key keeps its first answer; while a run is active, 'busy' and nothing recorded. */
export function startTurn(adapter: Adapter, conv: Conversation, input: TurnInput, key: string): StartResult {
  const existing = conv.submissions.get(key)
  if (existing) return existing.admission as StartResult
  // H2 coding-agent: admissions live in this process; a key on the branch was started before it.
  if (keysOf(historyOf(conv.manager.getBranch(), conv.thread)).has(key)) return 'started'
  if (conv.active || !piIdle(conv)) return 'busy'
  return submit(adapter, conv, key, input)
}

/** Queues `input` behind the inbox; with no run active, the oldest queued input starts. */
export function submit(adapter: Adapter, conv: Conversation, key: string, input: TurnInput | string): StartResult {
  const admission: StartResult = conv.active || conv.inbox.length > 0 || !piIdle(conv) ? 'queued' : 'started'
  conv.submissions.set(key, { input, admission, state: 'queued' })
  conv.inbox.push(key)
  drain(adapter, conv)
  return admission
}

export function drain(adapter: Adapter, conv: Conversation): void {
  if (conv.active || !piIdle(conv)) return
  const key = conv.inbox.shift()
  if (key !== undefined) startRun(adapter, conv, key)
}

/** Starts a run with submission `key`: a person's text as a prompt, a turn input as its custom message. */
export function startRun(adapter: Adapter, conv: Conversation, key: string): void {
  const native = conv.native
  if (!native) throw new Error(`Conversation ${conv.thread} has no session`)
  const submission = conv.submissions.get(key)!
  let end!: () => void
  const done = new Promise<void>((resolve) => {
    end = resolve
  })
  conv.runs += 1
  const { input } = submission
  const run: RunState = {
    run: conv.runs,
    key,
    after: conv.manager.getLeafId(),
    startedBy: typeof input === 'string' ? undefined : input.kind,
    pending: true,
    stopRequested: false,
    requests: 0,
    window: [],
    done,
    end
  }
  conv.active = run
  conv.latest = run
  conv.runUsage.push(ZERO_USAGE)
  submission.state = 'running'
  submission.run = run.run
  void adapter.track(done)
  const started =
    typeof input === 'string'
      ? native.prompt(input, {
          // A command Pi handled locally starts no run.
          preflightResult: (disposition) => {
            if (disposition === 'handled' && conv.active === run) finishRun(adapter, conv, undefined)
          }
        })
      : native.session.sendCustomMessage(markerMessage(input, key), { triggerTurn: true })
  started.catch((error: unknown) => {
    adapter.report(error)
    if (conv.active !== run) return
    const message = error instanceof Error ? error.message : String(error)
    finishRun(adapter, conv, { live: 'error', answer: { outcome: 'failed', text: '', error: message } })
  })
}

/** How the active run ended, from Pi's settle and the run's last reply. */
export function endingOf(run: RunState, aborted: boolean): RunEnding {
  const reply = run.lastReply
  const text = reply ? textOf(reply.content) : ''
  if (run.refused !== undefined)
    return { live: 'error', answer: { outcome: 'limit_reached', text, error: run.refused } }
  if (aborted || reply?.stopReason === 'aborted') return { live: 'aborted', answer: { outcome: 'aborted', text } }
  if (reply?.stopReason === 'error') {
    const failed = { outcome: 'failed', text } as const
    return {
      live: 'error',
      answer: reply.errorMessage === undefined ? failed : { ...failed, error: reply.errorMessage }
    }
  }
  return { live: 'completed', answer: { outcome: reply?.stopReason === 'length' ? 'truncated' : 'completed', text } }
}

/** Ends the active run; `ending` is undefined when Pi ran nothing. Queued input starts only after a completed run. */
export function finishRun(adapter: Adapter, conv: Conversation, ending: RunEnding | undefined): void {
  const run = conv.active
  if (!run) return
  conv.active = undefined
  if (ending) {
    conv.ends.set(run.run, ending)
    conv.lastEnd = ending.live
  }
  for (const submission of conv.submissions.values())
    if (submission.run === run.run && submission.state === 'running') submission.state = 'settled'
  // Steers the run never placed missed its last boundary: withdrawn, never carried into the next run (G-C5).
  withdrawAll(conv, [...conv.held.splice(0), ...conv.steered])
  if (conv.steered.size > 0) conv.native?.session.agent.clearSteeringQueue()
  conv.steered.clear()
  run.end()
  if (ending === undefined || ending.live === 'completed') drain(adapter, conv)
  wake(conv)
}

/** H2 stop: withdraws queued input, aborts the active run with the foreground children it owns, resolves once it ended. */
export async function stopRun(adapter: Adapter, conv: Conversation): Promise<void> {
  // A steer handed to Pi is being placed; the run's end withdraws it if it was not.
  withdrawAll(conv, [...conv.inbox.splice(0), ...conv.held.splice(0)])
  wake(conv)
  const run = conv.active
  if (!run) return
  run.stopRequested = true
  const owned = [...adapter.conversations.values()].filter(
    (child) => child.owner?.thread === conv.thread && child.owner.run === run.run
  )
  // Not awaited before the children: the run's tool call may be waiting on one of them.
  const aborting = conv.native!.session.abort()
  await Promise.all(owned.map((child) => stopRun(adapter, child)))
  await aborting
  await run.done
}

/** H2: the entry the latest run in this process began with, its input; `undefined` until Pi has written it. */
export function latestStart(conv: Conversation): string | undefined {
  const run = conv.latest
  if (!run) return undefined
  const branch = conv.manager.getBranch()
  const input = conv.submissions.get(run.key)!.input
  return branch
    .slice(branch.findIndex((entry) => entry.id === run.after) + 1)
    .find((entry) =>
      typeof input === 'string'
        ? entry.type === 'message' && entry.message.role === 'user'
        : entry.type === 'custom_message' && keyOf(entry.details) === run.key
    )?.id
}

export function retract(conv: Conversation, key: string): RetractResult {
  const submission = conv.submissions.get(key)
  if (!submission) return 'not-found'
  // A steer handed to Pi at a turn's end is being placed in that run.
  if (submission.state === 'running' || conv.steered.has(key)) return 'already-started'
  if (submission.state === 'settled') return 'settled'
  withdraw(conv, key)
  return 'withdrawn'
}

/** Takes back input `key` that no run has taken yet, from the inbox or the held steers. */
export function withdraw(conv: Conversation, key: string): void {
  const submission = conv.submissions.get(key)
  if (submission?.state !== 'queued' || conv.steered.has(key)) return
  submission.state = 'withdrawn'
  for (const list of [conv.inbox, conv.held]) {
    const at = list.indexOf(key)
    if (at >= 0) list.splice(at, 1)
  }
  wake(conv)
}

/** Withdraws the inputs `keys` names that no run took. */
function withdrawAll(conv: Conversation, keys: readonly string[]): void {
  for (const key of keys) {
    const submission = conv.submissions.get(key)!
    if (submission.state === 'queued') submission.state = 'withdrawn'
  }
}

/** H5 untilDone: the input ran to the end of its run, was withdrawn, or was never submitted here (a 'busy' start). */
export function inputDone(conv: Conversation, key: string): boolean {
  const state = conv.submissions.get(key)?.state
  return state === undefined || state === 'settled' || state === 'withdrawn'
}

/** Message ends of the active run: its last reply and usage, and the steered messages Pi placed in it. */
export function noteMessage(conv: Conversation, message: MessageEndEvent['message']): void {
  const run = conv.active
  if (!run) return
  if (message.role === 'assistant') {
    run.lastReply = message
    conv.runUsage[run.run - 1] = addUsage(conv.runUsage[run.run - 1], usageFact(message.usage))
    return
  }
  if (message.role !== 'custom') return
  const key = keyOf(message.details)
  const submission = key === undefined ? undefined : conv.submissions.get(key)
  if (key === undefined || submission?.state !== 'queued') return
  submission.state = 'running'
  submission.run = run.run
  conv.steered.delete(key)
  // The steer's `message` answers now (H3).
  wake(conv)
}

/**
 * H3 message: an idle child starts a run with it; a running one takes it as a steer into the run in progress. With
 * `run`, only run `run` may take it: when that is not the active run, it is withdrawn at once.
 */
export function messageChild(
  adapter: Adapter,
  conv: Conversation,
  input: TurnInput,
  key: string,
  run?: number
): MessageResult {
  const existing = conv.submissions.get(key)
  if (existing) return existing.admission as MessageResult
  const active = conv.active
  if (run !== undefined && active?.run !== run) {
    const admission: MessageResult = { run, status: 'withdrawn' }
    conv.submissions.set(key, { input, admission, state: 'withdrawn' })
    return admission
  }
  // Nothing is recorded for a child still launching, so the same key can be sent once it has launched.
  if (!conv.native) throw new Error(`Child ${conv.thread} is still launching`)
  if (!active) {
    const admission: MessageResult = { run: conv.runs + 1, status: 'started' }
    conv.submissions.set(key, { input, admission, state: 'queued' })
    answerOpenCalls(conv)
    startRun(adapter, conv, key)
    return admission
  }
  const admission: MessageResult = { run: active.run, status: 'queued' }
  conv.submissions.set(key, { input, admission, state: 'queued' })
  conv.held.push(key)
  return admission
}

/** H3: before a run starts, each open call of the child's last reply gets the interrupted result, unless it failed. */
function answerOpenCalls(conv: Conversation): void {
  const entries = conv.manager.getBranch()
  const at = entries.findLastIndex((entry) => entry.type === 'message' && entry.message.role === 'assistant')
  const reply = entries[at]
  if (reply?.type !== 'message' || reply.message.role !== 'assistant') return
  if (reply.message.stopReason === 'error' || reply.message.stopReason === 'aborted') return
  const open = unansweredCalls(entries, at)
  for (const call of open) conv.manager.appendMessage(resultFor(call, INTERRUPTED_CALL_RESULT, true))
  // Pi's in-memory transcript follows its storage only when refreshed.
  if (open.length > 0) conv.native!.session.refreshContext()
}

/**
 * At each turn's end, right before Pi polls its steering queue: the oldest held steer goes to Pi, which places it
 * before the next request. A failed or aborted turn takes none; its run ends, which withdraws them.
 */
export function offerSteer(conv: Conversation, reply: TurnEndEvent['message']): void {
  if (!conv.active || (reply.role === 'assistant' && (reply.stopReason === 'error' || reply.stopReason === 'aborted')))
    return
  const key = conv.held.shift()
  if (key === undefined) return
  conv.steered.add(key)
  void conv.native!.session.sendCustomMessage(markerMessage(conv.submissions.get(key)!.input as TurnInput, key), {
    triggerTurn: true
  })
}

/** H3 awaitAnswer: the end of the run that took message `key`; one withdrawn before it ran answers with run `run`. */
export async function awaitAnswer(conv: Conversation, run: number, key: string): Promise<RunEndFacts> {
  const submission = conv.submissions.get(key)
  if (!submission) throw new Error(`No message ${key} was sent to ${conv.thread}`)
  const answering = () => submission.run ?? (submission.state === 'withdrawn' ? run : undefined)
  await waitFor(conv, () => {
    const at = answering()
    return at !== undefined && conv.ends.has(at)
  })
  return conv.ends.get(answering()!)!.answer
}
