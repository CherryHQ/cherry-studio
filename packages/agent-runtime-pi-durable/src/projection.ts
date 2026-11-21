import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import type { ConversationView, EntryRecord, LiveState, SubmissionRecord } from '@earendil-works/pi-durable'

import { subagentResults, type HistoryEntry, type SubagentResults } from '@cherrystudio/agent-behavior'
import {
  projectNestedTool,
  runtimeId,
  ThreadFeed,
  type InputId,
  type InputState,
  type Observation,
  type ObservationPayload,
  type OperationResult,
  type RuntimeMessage,
  type Thread
} from '@cherrystudio/agent-runtime'

import { ContentProjection, entryMessageId } from './content'
import type { PreviewTextAppend } from './previewTextAppends'

export interface DurableObservation {
  readonly events: readonly ObservationPayload[]
  readonly aliases: Readonly<Record<string, string>>
  readonly live: readonly string[]
  readonly completion?: { readonly inputs: readonly InputState[]; readonly entryId?: string }
  readonly backgroundResults: OperationResult<SubagentResults>
}

/** One normalized source shared by every access to a native conversation. */
export class DurableProjection {
  readonly feed: ThreadFeed
  private readonly epoch = randomUUID()
  private preview?: { id: string; task: number; attempt: number; after: number }
  private previewSequence = 0
  readonly aliases: Record<string, string> = {}

  private view?: ConversationView
  private revision?: number
  private pending = false
  private readonly admitting = new Set<InputId>()
  private readonly cycle = new Set<string>()
  private completion?: DurableObservation['completion']
  private history: readonly HistoryEntry[] = []
  private committed?: { readonly entries: readonly EntryRecord[]; readonly content: ContentProjection }
  private backgroundResults: DurableObservation['backgroundResults'] = {
    status: 'confirmed',
    value: { active: false, pending: [], notification: [] }
  }

  constructor(
    readonly ref: Thread,
    report: (error: unknown) => void
  ) {
    this.feed = new ThreadFeed(
      {
        type: 'snapshot',
        messages: [],
        inputs: [],
        subagents: [],
        activity: { state: 'unknown' }
      },
      report
    )
  }

  async close(): Promise<void> {
    this.feed.close('shutdown')
  }

  observe(sink: (batch: DurableObservation) => void | Promise<void>): Observation {
    const active = this.preview?.id
    const snapshot = this.feed.snapshot
    const pending = snapshot.inputs.findLast((input) => !input.outcome && input.facts.includes('placed'))
    const anchors = pending?.inputId
      ? snapshot.messages.flatMap((message, index) =>
          message.role === 'user' && message.metadata?.inputId === pending.inputId ? [index] : []
        )
      : []
    const boundary = anchors.length === 1 ? anchors[0] : Infinity
    const baseline = new Set(
      snapshot.messages
        .filter((message, index) => message.id === active || (index > boundary && message.role === 'assistant'))
        .map((message) => message.id)
    )
    const historical = new Set(
      snapshot.messages.filter((message) => !baseline.has(message.id)).map((message) => message.id)
    )
    return this.feed.observeCaptured(sink, (event, delivery) => {
      if (event.type === 'message.text-append')
        return {
          value: {
            events: [event],
            aliases: {},
            live: [event.ref.id],
            backgroundResults: this.backgroundResults
          }
        }
      for (const [committed, preview] of Object.entries(this.aliases))
        if (historical.has(preview)) historical.add(committed)
      const messages =
        event.type === 'snapshot' ? event.messages : event.type === 'message.upsert' ? [event.message] : []
      const completion = delivery === 'baseline' ? undefined : this.completion
      return {
        value: {
          events: [event],
          aliases: this.aliases,
          live: messages
            .filter((message) => (delivery === 'baseline' ? baseline.has(message.id) : !historical.has(message.id)))
            .map((message) => message.id),
          completion,
          backgroundResults: this.backgroundResults
        },
        retain: Boolean(completion)
      }
    })
  }

  input(input: InputState): void {
    if (!this.view) return
    const known = this.feed.state.inputs.find((value) => value.inputId && value.inputId === input.inputId)
    if (known && !input.nativeInput && (known.nativeInput || known.outcome)) return
    this.update(this.view, this.revision, [input])
  }

  beginAdmission(inputId: InputId): void {
    this.admitting.add(inputId)
    if (this.view) this.update(this.view, this.revision)
  }

  endAdmission(inputId: InputId, accepted: boolean): void {
    this.admitting.delete(inputId)
    if (!accepted && !this.cycle.size) this.pending = false
    if (this.view) this.update(this.view, this.revision)
  }

  appendPreview(view: ConversationView, appends: readonly PreviewTextAppend[]): boolean {
    const live = view.docs['pi.live'] as LiveState | undefined
    const preview = this.preview
    if (!preview || live?.run?.taskId !== preview.task || live.generation?.attempt !== preview.attempt) return false
    if (!appends.every(({ part }) => this.feed.hasStreamingText(preview.id, part))) return false
    this.view = view
    this.revision = undefined
    const ref = { session: this.ref, id: runtimeId<'item'>(preview.id) }
    for (const append of appends) this.feed.publish({ type: 'message.text-append', ref, ...append })
    return true
  }

  update(view: ConversationView, revision?: number, changed: readonly InputState[] = [], history = this.history): void {
    this.view = view
    this.revision = revision
    this.history = history
    const previousState = this.feed.state
    let inputs = previousState.inputs
    changed = changed.filter((input) => !inputs.some((known) => isDeepStrictEqual(known, input)))
    for (const input of changed) {
      inputs = [
        ...inputs.filter(
          (known) =>
            !(input.inputId && known.inputId === input.inputId) &&
            !(input.nativeInput && known.nativeInput?.id === input.nativeInput.id)
        ),
        input
      ]
      if (revision !== undefined) this.cycle.add(input.nativeInput?.id ?? input.inputId!)
    }
    for (const input of inputs)
      if (!input.outcome && !input.facts.includes('locally-handled'))
        this.cycle.add(input.nativeInput?.id ?? input.inputId!)
    const unfinished = inputs.some((input) => !input.outcome && !input.facts.includes('locally-handled'))
    const live = view.docs['pi.live'] as LiveState | undefined
    const content = this.committedContent(view.entries).fork()
    const after = view.entries.reduce((latest, entry) => Math.max(latest, entry.id), 0)
    const generation = live?.generation
    const previous = this.preview
    const preview =
      generation?.message && live?.run
        ? previous?.task === live.run.taskId && previous.attempt === generation.attempt
          ? previous
          : {
              id: `live:${this.epoch}:${live.run.taskId}:${generation.attempt}:${++this.previewSequence}`,
              task: live.run.taskId,
              attempt: generation.attempt,
              after
            }
        : undefined
    if (generation?.message && preview) content.message(generation.message, preview.id, 'partial')
    for (const slot of live?.tools ?? []) {
      if (slot.output !== undefined && slot.taskId && !slot.entry) {
        content.progress(slot.callId, slot.output)
      }
    }
    for (const slot of live?.tools ?? [])
      for (const record of slot.nestedCalls?.calls ?? []) content.nested(slot.callId, projectNestedTool(record))
    for (const slot of live?.nestedTools ?? []) {
      if (slot.summary) continue
      const part = {
        type: 'dynamic-tool' as const,
        toolName: slot.name,
        toolCallId: slot.callId,
        state: 'input-available' as const,
        input: slot.arguments,
        callProviderMetadata: { pi: { parentToolCallId: slot.parentCallId, nested: true } }
      }
      content.nested(slot.parentCallId, part)
      if (slot.output !== undefined) content.progress(slot.callId, slot.output)
      for (const child of slot.nestedCalls?.calls ?? []) content.nested(slot.callId, projectNestedTool(child))
    }
    const pending = Boolean(this.admitting.size || live?.run || live?.compactions?.length || unfinished)
    const previousResults = this.backgroundResults
    const results = subagentResults(history, Boolean(live?.run))
    this.backgroundResults = results
      ? { status: 'confirmed', value: results }
      : {
          status: 'unknown',
          error: {
            operation: 'backgroundResults',
            code: 'missing-result-origin',
            message: 'A Durable background result has no recorded triggering call'
          }
        }
    const completion =
      !pending && (this.pending || this.cycle.size > 0) && revision !== undefined
        ? {
            inputs: inputs.filter((input) => this.cycle.has(input.nativeInput?.id ?? input.inputId!)),
            entryId: view.entries.at(-1)?.id.toString()
          }
        : undefined
    if (completion) this.cycle.clear()
    this.pending = pending
    let reset = false
    if (previous && previous !== preview) {
      const candidates = view.entries.flatMap((entry) =>
        entry.byTaskId === previous.task && entry.id > previous.after
          ? (entry.model ?? []).flatMap((message, index) => (message.role === 'assistant' ? [{ entry, index }] : []))
          : []
      )
      if (candidates.length !== 1) reset = true
      else {
        const { entry, index } = candidates[0]
        this.aliases[entryMessageId(entry, index)] = previous.id
      }
    }
    if (reset) this.feed.publish({ type: 'gap', reason: 'mapping-reset' })
    this.preview = preview
    content.seal()
    const activity = { state: live?.run ? ('active' as const) : ('idle' as const) }
    // A run start sends a snapshot so observers see its inputs and activity in one frame; so do the first
    // publication and a reset. Other updates carry only changes.
    const messages =
      reset ||
      (previousState.activity.state !== 'active' && activity.state === 'active') ||
      previousState.activity.state === 'unknown'
        ? undefined
        : messageChanges(this.ref, this.feed.snapshot.messages, content.messages, this.aliases)
    const events: ObservationPayload[] = [
      ...(messages ?? [{ ...previousState, messages: content.messages, inputs, activity }]),
      ...changed.map((input) => ({ type: 'input.changed' as const, input }))
    ]
    if (
      messages &&
      (previousState.activity.state !== activity.state ||
        (!events.length && (completion || !isDeepStrictEqual(previousResults, this.backgroundResults))))
    )
      events.push({ type: 'activity.changed', activity })
    // Completion rides the first frame after which an observer holds the whole update.
    const carrier = messages ? events.length - 1 : 0
    events.forEach((event, index) => {
      this.completion = index === carrier ? completion : undefined
      this.feed.publish(event)
    })
    this.completion = undefined
  }

  /** Native views append the same entry records; project only appended entries and share the rest. */
  private committedContent(entries: readonly EntryRecord[]): ContentProjection {
    const previous = this.committed
    const extended =
      previous !== undefined &&
      previous.entries.length <= entries.length &&
      previous.entries.every((entry, index) => entries[index] === entry)
    const content = extended ? previous.content : new ContentProjection()
    for (const entry of entries.slice(extended ? previous.entries.length : 0)) content.entry(entry)
    content.seal()
    this.committed = { entries, content }
    return content
  }
}

/**
 * Upserts and removals that turn `previous` into `next` under feed semantics: a new message appends unless it replaces
 * the preview it was committed from. Returns undefined when the order cannot follow, so the caller sends a snapshot.
 */
function messageChanges(
  session: Thread,
  previous: readonly RuntimeMessage[],
  next: readonly RuntimeMessage[],
  aliases: Readonly<Record<string, string>>
): ObservationPayload[] | undefined {
  const before = new Map(previous.map((message) => [message.id, message]))
  const after = new Set(next.map((message) => message.id))
  const replaced = new Map<string, string>()
  for (const message of next) {
    const preview = aliases[message.id]
    if (!before.has(message.id) && preview && before.has(preview) && !after.has(preview))
      replaced.set(message.id, preview)
  }
  const consumed = new Set(replaced.values())
  const removed = previous.filter((message) => !after.has(message.id) && !consumed.has(message.id))
  const events: ObservationPayload[] = removed.map((message) => ({
    type: 'message.remove',
    ref: { session, id: runtimeId(message.id) }
  }))
  let order = previous.flatMap((message) => (after.has(message.id) || consumed.has(message.id) ? [message.id] : []))
  for (const message of next) {
    const known = before.get(message.id)
    const preview = replaced.get(message.id)
    if (preview) {
      events.push({ type: 'message.upsert', message, replaces: [{ session, id: runtimeId(preview) }] })
      order = order.map((id) => (id === preview ? message.id : id))
    } else if (!known) {
      events.push({ type: 'message.upsert', message })
      order.push(message.id)
    } else if (known !== message && !isDeepStrictEqual(known, message)) {
      const changedParts = message.parts.flatMap((part, index) => (part === known.parts[index] ? [] : [index]))
      events.push({ type: 'message.upsert', message, changedParts })
    }
  }
  return isDeepStrictEqual(order, [...after]) ? events : undefined
}

export function submissionState(
  thread: Thread,
  record: SubmissionRecord,
  entry?: EntryRecord,
  inputId?: InputId
): InputState {
  let terminal: Pick<InputState, 'outcome' | 'error'> = {}
  if (record.type === 'input' && record.status === 'done') {
    const index = entry?.model?.findIndex((message) => message.role === 'assistant') ?? -1
    const message = entry?.model?.[index]
    if (message?.role === 'assistant') {
      const reason = message.stopReason
      const completed = reason === 'stop' && !message.content.some((part) => part.type === 'toolCall')
      terminal = {
        outcome: completed
          ? 'completed'
          : reason === 'aborted'
            ? 'aborted'
            : reason === 'error'
              ? 'failed'
              : 'unanswered',
        ...(!completed && {
          error: {
            operation: 'input',
            code:
              reason === 'length'
                ? 'output-truncated'
                : reason === 'error'
                  ? 'model-error'
                  : reason === 'aborted'
                    ? 'aborted'
                    : 'no-final-answer',
            message: message.errorMessage ?? `Durable response ended: ${reason}`
          }
        })
      }
    }
  } else if (record.status === 'unanswered') {
    terminal = {
      outcome:
        record.reason === 'aborted'
          ? 'aborted'
          : ['model_error', 'no_model', 'faulted'].includes(record.reason)
            ? 'failed'
            : 'unanswered',
      error: {
        operation: 'input',
        code: record.reason,
        message: typeof record.detail === 'string' ? record.detail : record.reason
      }
    }
  }
  return {
    nativeInput: { session: thread, id: runtimeId(String(record.id)) },
    ...(inputId && { inputId }),
    facts:
      record.status === 'queued'
        ? ['accepted', 'queued']
        : record.entry !== undefined
          ? ['accepted', 'placed']
          : ['accepted'],
    ...terminal
  }
}
