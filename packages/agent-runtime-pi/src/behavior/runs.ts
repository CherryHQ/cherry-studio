import type { MessageEndEvent } from '@earendil-works/pi-coding-agent'

import type { RetractResult, StartResult, TurnInput } from '@cherrystudio/agent-behavior'

import { addUsage, historyOf, keyOf, keysOf, textOf, usageFact, ZERO_USAGE } from './history'
import { type Adapter, type Conversation, markerMessage, piIdle, type RunEnding, type RunState, wake } from './state'

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
    startedBy: typeof input === 'string' ? undefined : input.kind,
    pending: true,
    stopRequested: false,
    requests: 0,
    window: [],
    done,
    end
  }
  conv.active = run
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
  // Messages Pi took for this run but never placed missed its last boundary; they wait for the next run.
  const missed = [...conv.steered].filter((key) => conv.submissions.get(key)?.state === 'queued')
  if (missed.length > 0) conv.native?.session.clearQueue()
  conv.steered.clear()
  conv.inbox.push(...conv.held.splice(0), ...missed)
  run.end()
  if (ending === undefined || ending.live === 'completed') drain(adapter, conv)
  wake(conv)
}

/** H2 stop: withdraws queued input, aborts the active run with the foreground children it owns, resolves once it ended. */
export async function stopRun(adapter: Adapter, conv: Conversation): Promise<void> {
  for (const key of [...conv.inbox.splice(0), ...conv.held.splice(0), ...conv.steered]) {
    const submission = conv.submissions.get(key)!
    if (submission.state === 'queued') submission.state = 'withdrawn'
  }
  if (conv.steered.size > 0) conv.native?.session.clearQueue()
  conv.steered.clear()
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

export function retract(conv: Conversation, key: string): RetractResult {
  const submission = conv.submissions.get(key)
  if (!submission) return 'not-found'
  // A steer Pi holds joins the running run; Pi cannot give it back alone.
  if (submission.state === 'running' || conv.steered.has(key)) return 'already-started'
  if (submission.state === 'settled') return 'settled'
  submission.state = 'withdrawn'
  for (const list of [conv.inbox, conv.held]) {
    const at = list.indexOf(key)
    if (at >= 0) list.splice(at, 1)
  }
  wake(conv)
  return 'withdrawn'
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
}
