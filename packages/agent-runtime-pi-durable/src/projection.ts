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
  type Thread
} from '@cherrystudio/agent-runtime'

import { ContentProjection, entryMessageId } from './content'

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
    const historical = new Set(
      this.feed.snapshot.messages.filter((message) => message.id !== active).map((message) => message.id)
    )
    return this.feed.observeCaptured(sink, (event, delivery) => {
      for (const [committed, preview] of Object.entries(this.aliases))
        if (historical.has(preview)) historical.add(committed)
      const messages =
        event.type === 'snapshot' ? event.messages : event.type === 'message.upsert' ? [event.message] : []
      const completion = delivery === 'baseline' || event.type !== 'snapshot' ? undefined : this.completion
      return {
        value: {
          events: [event],
          aliases: this.aliases,
          live: messages
            .filter((message) => (delivery === 'baseline' ? message.id === active : !historical.has(message.id)))
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
    const known = this.feed.snapshot.inputs.find((value) => value.inputId && value.inputId === input.inputId)
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

  update(view: ConversationView, revision?: number, changed: readonly InputState[] = [], history = this.history): void {
    this.view = view
    this.revision = revision
    this.history = history
    let inputs = this.feed.snapshot.inputs
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
    const content = new ContentProjection()
    for (const entry of view.entries) content.entry(entry)
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
    this.completion =
      !pending && (this.pending || this.cycle.size > 0) && revision !== undefined
        ? {
            inputs: inputs.filter((input) => this.cycle.has(input.nativeInput?.id ?? input.inputId!)),
            entryId: view.entries.at(-1)?.id.toString()
          }
        : undefined
    if (this.completion) this.cycle.clear()
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
    this.feed.publish({
      ...this.feed.snapshot,
      messages: content.messages,
      inputs,
      activity: { state: live?.run ? 'active' : 'idle' }
    })
    this.completion = undefined
    for (const input of changed) this.feed.publish({ type: 'input.changed', input })
  }
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
