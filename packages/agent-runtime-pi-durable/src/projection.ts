import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import type { ConversationView, EntryRecord, LiveState, ToolSlot, TaskId } from '@earendil-works/pi-durable'

import { subagentResults, type HistoryEntry, type SubagentResults } from '@cherrystudio/agent-behavior'
import {
  isLivePartInput,
  immutable,
  messageObservation,
  textEdits,
  type RuntimePartEdit,
  type Activity,
  runtimeId,
  ThreadFeed,
  type InputId,
  type InputState,
  type Observation,
  type ObservationPayload,
  type OperationResult,
  type ProjectionEvents,
  type RuntimeMessage,
  type Thread
} from '@cherrystudio/agent-runtime'

import { ContentProjection, entryMessageId, messagePart, previewToolOutput } from './content'
import type { PreviewTextAppend } from './previewTextAppends'

type AnswerPosition = { readonly inputId: InputId; readonly entryId: string }

export interface DurableObservation {
  readonly events: ProjectionEvents
  readonly aliases: Readonly<Record<string, string>>
  readonly live: readonly string[]
  readonly answers?: readonly AnswerPosition[]
  readonly resumedInput?: InputId
  readonly completion?: { readonly inputs: readonly InputState[]; readonly entryId?: string }
  readonly backgroundResults: OperationResult<SubagentResults>
}

type InputPublication =
  | { type: 'snapshot'; inputs: readonly InputState[]; answers?: readonly AnswerPosition[] }
  | { type: 'commit'; changes: readonly InputState[]; revision: number; answers?: readonly AnswerPosition[] }

/** One normalized source shared by every access to a native conversation. */
export class DurableProjection {
  readonly feed: ThreadFeed
  private readonly epoch = randomUUID()
  private preview?: { id: string; task: number; attempt: number; after: number }
  private previewSequence = 0
  readonly aliases: Record<string, string> = {}

  private nativeBusy = false
  private revision?: number
  private pending = false
  private readonly admitting = new Set<InputId>()
  private readonly cycle = new Set<string>()
  private completion?: DurableObservation['completion']
  private readonly answers = new Map<InputId, string>()
  private answerChanges?: readonly AnswerPosition[]
  private history: readonly HistoryEntry[] = []
  private committed?: { readonly entries: readonly EntryRecord[]; readonly content: ContentProjection }
  private backgroundResults: DurableObservation['backgroundResults'] = immutable({
    status: 'confirmed',
    value: { active: false, pending: [], notification: [] }
  })

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

  close(reason: 'shutdown' | 'source-lost' = 'shutdown'): void {
    this.feed.close(reason)
    this.committed = undefined
    this.history = []
    this.answers.clear()
  }

  observe(
    sink: (batch: DurableObservation) => void | Promise<void>,
    knownSources: readonly string[] = []
  ): Observation {
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
    const recoveredAliases =
      pending && knownSources.length ? this.recoverInterruptedPreviews(knownSources, baseline) : {}
    const historical = new Set(
      snapshot.messages.filter((message) => !baseline.has(message.id)).map((message) => message.id)
    )
    return this.feed.observeProjection<Omit<DurableObservation, 'events'>>(sink, (event, delivery) => {
      const replaced = event.type === 'message.reconcile' ? this.aliases[event.message.id] : undefined
      const aliases =
        event.type === 'snapshot'
          ? { ...recoveredAliases, ...this.aliases }
          : event.type === 'message.reconcile' && replaced
            ? { [event.message.id]: replaced }
            : {}
      for (const [committed, preview] of Object.entries(aliases)) if (historical.has(preview)) historical.add(committed)
      const ids =
        event.type === 'snapshot'
          ? event.messages.map((message) => message.id)
          : event.type === 'message.reconcile'
            ? [event.message.id]
            : event.type === 'message.parts' || 'part' in event
              ? [event.ref.id]
              : []
      const completion = delivery === 'baseline' ? undefined : this.completion
      const answers =
        delivery === 'baseline'
          ? [...this.answers].map(([inputId, entryId]) => ({ inputId, entryId }))
          : this.answerChanges
      return {
        value: {
          aliases,
          ...(delivery === 'baseline' && pending?.inputId && { resumedInput: pending.inputId }),
          live: ids.filter((id) => (delivery === 'baseline' ? baseline.has(id) : !historical.has(id))),
          completion,
          ...(answers?.length && { answers }),
          backgroundResults: this.backgroundResults
        },
        retain: Boolean(completion || answers?.length)
      }
    })
  }

  private recoverInterruptedPreviews(knownSources: readonly string[], baseline: ReadonlySet<string>) {
    const previews = new Map<number, { id: string; attempt: number }>()
    const known = new Set(knownSources)
    for (const id of knownSources) {
      const match = /^live:[^:]+:(\d+):(\d+):\d+$/.exec(id)
      if (match) previews.set(Number(match[1]), { id, attempt: Number(match[2]) })
    }
    const aliases: Record<string, string> = {}
    const active = this.preview
    const saved = active && previews.get(active.task)
    if (active && saved?.attempt === active.attempt) {
      if (!known.has(active.id)) aliases[active.id] = saved.id
      previews.delete(active.task)
    }
    // A generation may already have committed its interrupted output before the initial observation.
    const entries = this.committed?.entries ?? []
    for (let index = entries.length - 1; index >= 0 && previews.size; index--) {
      const entry = entries[index]
      if (entry.byTaskId === undefined) continue
      const preview = previews.get(entry.byTaskId)
      if (!preview) continue
      const position = entry.model?.findIndex(
        (message) => message.role === 'assistant' && message.stopReason === 'aborted'
      )
      if (position === undefined || position < 0) continue
      const committed = entryMessageId(entry, position)
      if (!baseline.has(committed)) continue
      if (!known.has(committed) && !this.aliases[committed]) aliases[committed] = preview.id
      previews.delete(entry.byTaskId)
    }
    return aliases
  }

  input(input: InputState): void {
    if (!this.committed) return
    const known = this.feed.state.inputs.find((value) => value.inputId && value.inputId === input.inputId)
    if (known && !input.nativeInput && (known.nativeInput || known.outcome)) return
    this.updateInputState([input])
  }

  beginAdmission(inputId: InputId): void {
    this.admitting.add(inputId)
    this.updateInputState()
  }

  endAdmission(inputId: InputId, accepted: boolean): void {
    this.admitting.delete(inputId)
    if (!accepted && !this.cycle.size) this.pending = false
    this.updateInputState()
  }

  private updateInputState(changed: readonly InputState[] = []): void {
    if (!this.committed) return
    const state = this.feed.state
    const { inputs, events } = this.acceptInputFacts(state.inputs, changed, this.revision)
    const completion = this.takeCompletion(inputs, this.revision, this.committed?.entries.at(-1)?.id)
    if (completion && !events.length) events.push({ type: 'activity.changed', activity: state.activity })
    this.publish(events, completion)
  }

  private acceptInputFacts(before: readonly InputState[], changed: readonly InputState[], revision?: number) {
    let inputs = before
    const events: ObservationPayload[] = []
    for (const input of changed) {
      if (before.some((known) => isDeepStrictEqual(known, input))) continue
      inputs = [
        ...inputs.filter(
          (known) =>
            !(input.inputId && known.inputId === input.inputId) &&
            !(input.nativeInput && known.nativeInput?.id === input.nativeInput.id)
        ),
        input
      ]
      if (revision !== undefined) this.cycle.add(input.nativeInput?.id ?? input.inputId!)
      events.push({ type: 'input.changed', input })
    }
    return { inputs, events }
  }

  private takeCompletion(
    inputs: readonly InputState[],
    revision: number | undefined,
    head: EntryRecord['id'] | undefined
  ): DurableObservation['completion'] {
    let unfinished = false
    for (const input of inputs) {
      if (input.outcome || input.facts.includes('locally-handled')) continue
      this.cycle.add(input.nativeInput?.id ?? input.inputId!)
      unfinished = true
    }
    const pending = Boolean(this.admitting.size || this.nativeBusy || unfinished)
    const complete = !pending && (this.pending || this.cycle.size > 0) && revision !== undefined
    this.pending = pending
    if (!complete) return
    const completion = {
      inputs: inputs.filter((input) => this.cycle.has(input.nativeInput?.id ?? input.inputId!)),
      entryId: head?.toString()
    }
    this.cycle.clear()
    return completion
  }

  private publish(
    events: readonly ObservationPayload[],
    completion: DurableObservation['completion'],
    carrier = events.length - 1,
    answers?: readonly AnswerPosition[]
  ): void {
    try {
      events.forEach((event, index) => {
        this.completion = index === carrier ? completion : undefined
        this.answerChanges = index === carrier ? answers : undefined
        if (isLivePartInput(event)) this.feed.publishPart(event)
        else this.feed.publish(event)
      })
    } finally {
      this.completion = undefined
      this.answerChanges = undefined
    }
  }

  appendPreview(task: TaskId, attempt: number, appends: readonly PreviewTextAppend[]): boolean {
    const preview = this.preview
    if (!preview || task !== preview.task || attempt !== preview.attempt) return false
    if (!appends.every(({ part }) => this.feed.hasStreamingText(preview.id, part))) return false
    this.revision = undefined
    const ref = { session: this.ref, id: runtimeId<'item'>(preview.id) }
    for (const append of appends) this.feed.publishPart({ type: 'message.text-append', ref, ...append })
    return true
  }

  updatePreviewParts(
    task: TaskId,
    attempt: number,
    blocks: readonly { index: number; part: Parameters<typeof messagePart>[0] }[]
  ): boolean {
    const preview = this.preview
    if (!preview || task !== preview.task || attempt !== preview.attempt) return false
    const ref = { session: this.ref, id: runtimeId<'item'>(preview.id) }
    const changes: RuntimePartEdit[] = []
    for (const { index, part } of blocks) {
      const next = messagePart(part, 'streaming')
      const old = this.feed.part(preview.id, index)
      if (old && old.type !== next.type) return false
      if (next.type === 'text' || next.type === 'reasoning') changes.push(...textEdits(index, old, next))
      else if (!isDeepStrictEqual(old, next)) changes.push({ type: 'put', part: index, value: next })
    }
    if (changes.length && !this.feed.publishPart({ type: 'message.parts', ref, changes })) return false
    this.revision = undefined
    return true
  }

  previewTools(slots: readonly ToolSlot[]): boolean {
    if (!this.committed) return false
    const changes: Extract<ObservationPayload, { type: 'message.tool-output' }>[] = []
    for (const slot of slots) {
      if (slot.status !== 'running' || slot.output === undefined || slot.entry !== undefined) return false
      const tool = this.committed.content.tool(slot.callId)
      if (!tool || tool.part.state !== 'input-available') return false
      changes.push({
        type: 'message.tool-output',
        ref: { session: this.ref, id: runtimeId(tool.id) },
        part: tool.index,
        tool: previewToolOutput(tool.part, slot.output)
      })
    }
    this.revision = undefined
    for (const change of changes) this.feed.publishPart(change)
    return true
  }

  commitToolResult(
    before: ConversationView,
    view: ConversationView,
    entry: EntryRecord,
    revision: number,
    slotIndex: number
  ): boolean {
    const committed = this.committed
    if (!committed || committed.entries !== before.entries) return false
    if (view.entries.length !== before.entries.length + 1 || view.entries.at(-1)?.id !== entry.id) return false
    const result = entry.model?.[0]
    if (entry.kind !== 'pi.tool-result' || entry.model?.length !== 1 || result?.role !== 'toolResult') return false
    if (result.nestedCalls?.calls.length) return false
    const slot = (view.docs['pi.live'] as LiveState | undefined)?.tools?.[slotIndex]
    if (slot?.entry !== entry.id || slot.callId !== result.toolCallId) return false
    const tool = committed.content.result(result)
    if (!tool) return false
    committed.content.seal()
    this.committed = { entries: view.entries, content: committed.content }
    this.revision = revision
    this.feed.publishPart({
      type: 'message.tool-output',
      ref: { session: this.ref, id: runtimeId(tool.id) },
      part: tool.index,
      tool: tool.part
    })
    return true
  }

  update(view: ConversationView, publication?: InputPublication, history = this.history): void {
    const revision = publication?.type === 'commit' ? publication.revision : undefined
    this.revision = revision
    this.history = history
    const answers = (publication?.answers ?? []).filter((answer) => this.answers.get(answer.inputId) !== answer.entryId)
    for (const answer of answers) this.answers.set(answer.inputId, answer.entryId)
    const previousState = this.feed.state
    const { inputs, events: inputEvents } =
      publication?.type === 'snapshot'
        ? { inputs: publication.inputs, events: [] }
        : this.acceptInputFacts(previousState.inputs, publication?.changes ?? [], revision)
    const live = view.docs['pi.live'] as LiveState | undefined
    this.nativeBusy = Boolean(live?.run || live?.compactions?.length)
    const content = this.committedContent(view.entries)
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
              after: view.entries.reduce((latest, entry) => Math.max(latest, entry.id), 0)
            }
        : undefined
    const visible = content.liveMessages(live, preview?.id)
    const previousResults = this.backgroundResults
    const results = subagentResults(history, Boolean(live?.run))
    this.backgroundResults = immutable(
      results
        ? { status: 'confirmed', value: results }
        : {
            status: 'unknown',
            error: {
              operation: 'backgroundResults',
              code: 'missing-result-origin',
              message: 'A Durable background result has no recorded triggering call'
            }
          }
    )
    const completion = this.takeCompletion(inputs, revision, view.entries.at(-1)?.id)
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
    const retry = generation?.retry
    const activity: Activity = {
      state: live?.run ? 'active' : 'idle',
      ...(retry?.model !== undefined &&
        retry.nextAttempt !== undefined && {
          modelRetry: { modelId: retry.model, attempt: retry.nextAttempt, reason: retry.error }
        })
    }
    // A run start sends a snapshot so observers see its inputs and activity in one frame; so do the first
    // publication and a reset. Other updates carry only changes.
    const messages =
      publication?.type === 'snapshot' ||
      reset ||
      (previousState.activity.state !== 'active' && activity.state === 'active') ||
      previousState.activity.state === 'unknown'
        ? undefined
        : messageChanges(this.ref, this.feed.snapshot.messages, visible, this.aliases)
    const events: ObservationPayload[] = [
      ...(messages ?? [{ ...previousState, messages: visible, inputs, activity }]),
      ...inputEvents
    ]
    if (
      messages &&
      (!isDeepStrictEqual(previousState.activity, activity) ||
        (!events.length &&
          (completion || answers.length || !isDeepStrictEqual(previousResults, this.backgroundResults))))
    )
      events.push({ type: 'activity.changed', activity })
    // Completion rides the first frame after which an observer holds the whole update.
    this.publish(events, completion, messages ? events.length - 1 : 0, answers)
  }

  /** Native views append the same entry records; project only appended entries and share the rest. */
  private committedContent(entries: readonly EntryRecord[]): ContentProjection {
    const previous = this.committed
    if (previous?.entries === entries) return previous.content
    const extended =
      previous !== undefined &&
      previous.entries.length <= entries.length &&
      previous.entries.every((entry, index) => entries[index] === entry)
    const content = extended ? previous.content : ContentProjection.empty()
    for (let index = extended ? previous.entries.length : 0; index < entries.length; index++)
      content.entry(entries[index])
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
      const ref = { session, id: runtimeId<'item'>(preview) }
      const previous = before.get(preview)!
      for (const [part, value] of previous.parts.entries()) {
        if (
          (value.type === 'text' || value.type === 'reasoning') &&
          value.state === 'streaming' &&
          isDeepStrictEqual({ ...value, state: 'done' }, message.parts[part])
        )
          events.push({ type: 'message.text-finish', ref, part })
      }
      events.push({ type: 'message.reconcile', message, replaces: [ref] })
      order = order.map((id) => (id === preview ? message.id : id))
    } else if (!known) {
      events.push({ type: 'message.reconcile', message })
      order.push(message.id)
    } else if (known !== message && !isDeepStrictEqual(known, message)) {
      const changedParts = message.parts.flatMap((part, index) => (part === known.parts[index] ? [] : [index]))
      events.push(messageObservation({ session, id: runtimeId(message.id) }, known, message, undefined, changedParts))
    }
  }
  return isDeepStrictEqual(order, [...after]) ? events : undefined
}
