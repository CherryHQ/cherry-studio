import { randomUUID } from 'node:crypto'

import { copyJson, isJsonValue } from '@earendil-works/chord/json'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import {
  sessionEntryToContextMessages,
  type AgentSession,
  type AgentSessionEvent
} from '@earendil-works/pi-coding-agent'
import { parsePartialJson } from 'ai'

import { ENTRY_KINDS, type SubagentResults } from '@cherrystudio/agent-behavior'
import {
  immutable,
  messageObservation,
  projectNestedTool,
  runtimeId,
  ThreadFeed,
  textEdits,
  type RuntimeMessage,
  type InputId,
  type InputState,
  type ProductInputState,
  type ItemRef,
  type Observation,
  type OperationResult,
  type ProjectionEvents,
  type Thread
} from '@cherrystudio/agent-runtime'

import { readContextUsage } from './contextUsage'

function providerResult(value: unknown) {
  return isJsonValue(value) ? value : copyJson(value, { omitUndefinedProperties: true })
}

type PiMessage = AgentSession['messages'][number]
type PiContext = { message: PiMessage; id: string }[]
type NativeDelta = Extract<
  Extract<AgentSessionEvent, { type: 'message_update' }>['assistantMessageEvent'],
  { contentIndex: number }
>
type CapturedDelta<T = NativeDelta> = T extends NativeDelta
  ? Omit<T, 'partial'> & { part: NativeDelta['partial']['content'][number] | undefined }
  : never

export interface PiObservation {
  readonly backgroundResults?: OperationResult<SubagentResults>
  readonly events: ProjectionEvents
  readonly aliases: Readonly<Record<string, string>>
  readonly live: readonly string[]
  readonly settled: boolean
  readonly outcomes: readonly InputState[]
  readonly children: readonly { thread: Thread; outcome: string }[]
}

export class PiProjection {
  readonly feed: ThreadFeed
  private ids = new WeakMap<object, string>()
  private originals = new WeakMap<object, PiMessage>()
  private readonly aliases: Record<string, string> = {}
  private readonly inputStates = new Map<InputId, ProductInputState>()
  private inputIds = new WeakMap<object, InputId>()
  private active = new Map<string, string>()
  private calls = new Map<string, { id: string; index: number }>()
  private snapshotMessages?: Map<string, RuntimeMessage>
  private readonly partialArguments = new Map<string, string>()
  private pending = Promise.resolve()
  private backgroundResults?: OperationResult<SubagentResults>
  private settled = false
  private generation = 0
  private unsubscribe: () => void = () => {}

  constructor(
    readonly ref: Thread,
    private session: AgentSession,
    private readonly report: (error: unknown) => void,
    children: boolean
  ) {
    this.feed = new ThreadFeed(
      {
        type: 'snapshot',
        messages: [],
        inputs: [],
        ...(children ? { subagents: [] } : {}),
        activity: { state: session.isIdle ? 'idle' : 'active' }
      },
      report
    )
    this.bind(session)
    this.feed.publish({ type: 'context.changed', result: readContextUsage(session) })
    this.restoreContext(this.captureContext())
  }

  observe(sink: (batch: PiObservation) => void | Promise<void>): Observation {
    const historical = new Set(this.feed.messageIds)
    let children: { thread: Thread; outcome: string }[] = []
    let outcomes: readonly InputState[] = []
    const completedCalls = new Set<string>()
    return this.feed.observeProjection<Omit<PiObservation, 'events'>>(sink, (event, delivery) => {
      const replaced = event.type === 'message.reconcile' ? this.aliases[event.message.id] : undefined
      const aliases =
        event.type === 'snapshot'
          ? this.aliases
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
      if (delivery !== 'recovery') {
        children = []
        outcomes = event.type === 'input.changed' && event.input.outcome ? [event.input] : []
      }
      const changed =
        delivery !== 'update'
          ? []
          : event.type === 'message.reconcile'
            ? event.message.parts
            : event.type === 'message.parts'
              ? event.changes.flatMap((edit) => (edit.type === 'put' ? [edit.value] : []))
              : event.type === 'message.tool-output'
                ? [event.tool]
                : []
      for (const part of changed) {
        if (part.type !== 'dynamic-tool' || part.toolName !== 'subagent' || completedCalls.has(part.toolCallId))
          continue
        const output =
          part.state === 'output-error'
            ? part.resultProviderMetadata?.pi?.result
            : part.state === 'output-available' && !part.preliminary
              ? part.output
              : undefined
        if (!output || typeof output !== 'object' || Array.isArray(output) || !('details' in output)) continue
        const details = output.details
        if (!details || typeof details !== 'object' || Array.isArray(details)) continue
        if (
          'background' in details &&
          details.background === false &&
          'sessionId' in details &&
          typeof details.sessionId === 'string' &&
          'outcome' in details &&
          typeof details.outcome === 'string'
        ) {
          children.push({
            thread: { backendId: this.ref.backendId, id: runtimeId(details.sessionId) },
            outcome: details.outcome
          })
          completedCalls.add(part.toolCallId)
        }
      }
      const settled = delivery !== 'baseline' && this.settled
      return {
        value: {
          backgroundResults: this.backgroundResults,
          aliases,
          live: delivery === 'baseline' ? [] : ids.filter((id) => !historical.has(id)),
          settled,
          children,
          outcomes
        },
        retain: settled || children.length > 0 || outcomes.length > 0
      }
    })
  }

  results(result: OperationResult<SubagentResults>): void {
    // Capture one completed tool result before asynchronous projection can outlive native mutation.
    const captured = immutable(result)
    this.pending = this.pending
      .then(() => {
        this.backgroundResults = captured
        const current = this.feed.snapshot
        this.feed.publish({
          ...current,
          messages: current.messages.map((message) => ({ ...message, parts: message.parts.slice() }))
        })
      })
      .catch((error) => this.report(error))
  }

  rebind(session: AgentSession): void {
    this.unsubscribe()
    this.generation++
    this.partialArguments.clear()
    this.reset(session)
    this.bind(session)
  }

  private reset(session: AgentSession, context?: PiContext): void {
    this.session = session
    this.ids = new WeakMap()
    this.inputIds = new WeakMap()
    this.active.clear()
    this.calls.clear()
    this.feed.publish({ type: 'gap', reason: 'mapping-reset' })
    this.restoreContext(context ?? this.captureContext())
    this.feed.publish({ type: 'context.changed', result: readContextUsage(session) })
  }

  private captureContext(): PiContext {
    const own = this.ownEntryIds()
    return this.session.sessionManager
      .buildSessionProjection()
      .entries.filter(({ sourceEntry }) => !own || own.has(sourceEntry.id))
      .flatMap(({ sourceEntry, messages }) =>
        // Capture selected context entries at compaction/edit boundaries; strings such as image data are shared.
        messages.map((message) => ({ message: immutable(message), id: sourceEntry.id }))
      )
  }

  private restoreContext(context: PiContext): void {
    this.snapshotMessages = new Map()
    try {
      for (const entry of context) this.restoreCommitted(entry)
      this.feed.publish({
        ...this.feed.state,
        messages: [...this.snapshotMessages.values()],
        activity: { state: this.session.isIdle ? 'idle' : 'active' }
      })
    } finally {
      this.snapshotMessages = undefined
    }
  }

  private restoreCommitted({ message, id }: PiContext[number]): void {
    this.write(message, id, 'complete')
  }

  private ownEntryIds(): Set<string> | undefined {
    const branch = this.session.sessionManager.getBranch()
    const origin = branch.findLastIndex(
      (entry) => entry.type === 'custom' && entry.customType === ENTRY_KINDS.subagentOrigin
    )
    return origin < 0 ? undefined : new Set(branch.slice(origin + 1).map((entry) => entry.id))
  }

  /** Committed native entries and their proven live identities; copied parent context is excluded. */
  archive(): {
    messages: RuntimeMessage[]
    responseIds: Record<string, string>
    aliases: Record<string, string>
    legacy: Record<string, { messageId: string; parts: number[] }>
  } {
    const branch = this.session.sessionManager.getBranch()
    const start = branch.findLastIndex(
      (entry) => entry.type === 'custom' && entry.customType === ENTRY_KINDS.subagentOrigin
    )
    const calls = this.calls
    this.calls = new Map()
    this.snapshotMessages = new Map()
    const aliases: Record<string, string> = {}
    const responseIds: Record<string, string> = {}
    try {
      for (const entry of branch.slice(start + 1)) {
        if (entry.type !== 'message' && entry.type !== 'custom_message') continue
        const message = sessionEntryToContextMessages(entry)[0]
        if (message.role === 'assistant' && message.responseId) responseIds[message.responseId] = entry.id
        this.restoreCommitted({ message, id: entry.id })
        const live = this.ids.get(message)
        if (live && this.snapshotMessages.has(entry.id)) aliases[entry.id] = live
      }
      const legacy: Record<string, { messageId: string; parts: number[] }> = {}
      for (const message of this.snapshotMessages.values()) {
        const parts: number[] = []
        message.parts.forEach((part, index) => {
          if (part.type === 'dynamic-tool')
            legacy[`${message.id}:call:${part.toolCallId}`] = { messageId: message.id, parts: [index] }
          else parts.push(index)
        })
        legacy[message.id] = { messageId: message.id, parts }
      }
      return {
        messages: [...this.snapshotMessages.values()],
        responseIds,
        aliases: { ...aliases, ...this.aliases },
        legacy
      }
    } finally {
      this.snapshotMessages = undefined
      this.calls = calls
    }
  }

  private bind(session: AgentSession): void {
    this.unsubscribe = session.subscribe((native) => {
      if (native.type === 'message_update') {
        const id = this.active.get(native.message.role) ?? this.id(native.message)
        this.ids.set(native.message, id)
        const event = native.assistantMessageEvent
        if (!('contentIndex' in event)) return
        const { partial, ...delta } = event
        const part = partial.content[event.contentIndex]
        const captured = {
          ...delta,
          part:
            part?.type === 'toolCall'
              ? {
                  type: part.type,
                  id: part.id,
                  name: part.name,
                  // Capture only completed tool arguments; partial text updates never copy the native message graph.
                  arguments: event.type === 'toolcall_end' ? immutable(part.arguments) : {}
                }
              : part && { ...part }
        }
        this.enqueue(() => this.delta(captured, id))
        return
      }
      // Capture non-delta native facts before queueing without copying image data; published parts reuse the frozen values.
      const event = immutable(native)
      if ('message' in native && 'message' in event) {
        const message = native.message
        const slot = message.role === 'toolResult' ? `tool:${message.toolCallId}` : message.role
        const id = native.type === 'message_start' ? this.id(message) : (this.active.get(slot) ?? this.id(message))
        this.ids.set(message, id)
        this.ids.set(event.message, id)
        this.originals.set(event.message, message)
        if (native.type === 'message_start') this.active.set(slot, id)
        if (native.type === 'message_end') this.active.delete(slot)
        if (native.type === 'input_placed') {
          const inputId = runtimeId<'input'>(native.inputId)
          this.inputIds.set(message, inputId)
          this.inputIds.set(event.message, inputId)
        }
      }
      const context =
        event.type === 'entry_appended' &&
        (event.entry.type === 'custom_message' ||
          event.entry.type === 'context_edit' ||
          event.entry.type === 'compaction')
          ? this.captureContext()
          : undefined
      this.enqueue(() => this.event(event, context))
    })
  }

  private enqueue(work: () => Promise<void>): void {
    const generation = this.generation
    this.pending = this.pending
      .then(async () => {
        if (generation === this.generation) await work()
      })
      .catch((error) => {
        this.report(error)
        this.feed.publish({ type: 'gap', reason: 'disconnected' })
      })
  }

  async close(): Promise<void> {
    this.unsubscribe()
    await this.pending
    this.partialArguments.clear()
    this.feed.close('shutdown')
  }

  lookupInput(id: InputId): ProductInputState | undefined {
    return this.inputStates.get(id)
  }

  recordInput(input: ProductInputState): void {
    const previous = this.inputStates.get(input.inputId)
    const state = immutable({
      ...previous,
      ...input,
      facts: [...new Set([...(previous?.facts ?? []), ...input.facts])]
    })
    this.inputStates.set(input.inputId, state)
    this.feed.publish({ type: 'input.changed', input: state })
  }

  private id(message: PiMessage): string {
    const known = this.ids.get(message)
    if (known) return known
    const id = this.session.getCommittedEntryId(message) ?? `live:${randomUUID()}`
    this.ids.set(message, id)
    return id
  }

  private itemRef(id: string): ItemRef {
    return { session: this.ref, id: runtimeId(id) }
  }

  private publish(message: RuntimeMessage, replaces?: readonly ItemRef[]): void {
    if (this.snapshotMessages) {
      this.snapshotMessages.set(message.id, message)
      return
    }
    const event = messageObservation(this.itemRef(message.id), this.feed.message(message.id), message, replaces)
    if (event.type === 'message.parts') this.feed.publishPart(event)
    else this.feed.publish(event)
  }

  private nested(parentCallId: string, part: RuntimeMessage['parts'][number]): void {
    if (part.type !== 'dynamic-tool') return
    const id = this.calls.get(parentCallId)?.id
    if (!id) return
    const historical = this.snapshotMessages?.get(id)
    const length = this.snapshotMessages ? historical?.parts.length : this.feed.partCount(id)
    if (length === undefined) return
    const index = this.calls.get(part.toolCallId)?.index ?? length
    this.calls.set(part.toolCallId, { id, index })
    if (historical) historical.parts[index] = part
    else
      this.feed.publishPart({
        type: 'message.parts',
        ref: this.itemRef(id),
        changes: [{ type: 'put', part: index, value: part }]
      })
  }

  private result(update: ToolResultMessage | { toolCallId: string; partialResult: unknown }): void {
    const callId = update.toolCallId
    const address = this.calls.get(callId)
    if (!address) return
    const { id, index } = address
    const historical = this.snapshotMessages?.get(id)
    if (this.snapshotMessages && !historical) return
    const part = historical ? historical.parts[index] : this.feed.part(id, index)
    if (part?.type !== 'dynamic-tool' || part.toolCallId !== callId) return
    const base = {
      type: 'dynamic-tool' as const,
      toolCallId: callId,
      toolName: part.toolName,
      input: part.input,
      callProviderMetadata: part.callProviderMetadata
    }
    let tool: Extract<RuntimeMessage['parts'][number], { type: 'dynamic-tool' }>
    if ('partialResult' in update) {
      tool = { ...base, state: 'output-available', output: update.partialResult, preliminary: true }
    } else {
      const output = {
        content: update.content,
        ...(update.details !== undefined && { details: update.details }),
        ...(update.structuredContent !== undefined && { structuredContent: update.structuredContent }),
        ...(update.nestedCalls !== undefined && { nestedCalls: update.nestedCalls })
      }
      tool = update.isError
        ? {
            ...base,
            state: 'output-error',
            errorText: update.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('\n'),
            resultProviderMetadata: { pi: { result: providerResult(output) } }
          }
        : { ...base, state: 'output-available', output, preliminary: false }
    }
    if (historical) historical.parts[index] = tool
    else this.feed.publishPart({ type: 'message.tool-output', ref: this.itemRef(id), part: index, tool })
  }

  private finish(message: PiMessage, liveId: string, committedId: string | undefined): void {
    const id = committedId ?? liveId
    if (id !== liveId) {
      this.aliases[id] = liveId
      this.ids.set(message, id)
      const original = this.originals.get(message)
      if (original) this.ids.set(original, id)
    }
    this.write(message, id, 'complete', id === liveId ? undefined : [this.itemRef(liveId)])
  }

  private write(
    message: PiMessage,
    id: string,
    completeness: 'partial' | 'complete',
    replaces?: readonly ItemRef[]
  ): void {
    if (!('content' in message)) return
    if (message.role === 'toolResult') {
      for (const record of message.nestedCalls?.calls ?? []) {
        this.nested(message.toolCallId, projectNestedTool(record, providerResult))
      }
      this.result(message)
      return
    }
    if (
      message.role !== 'user' &&
      message.role !== 'assistant' &&
      message.role !== 'system' &&
      !(message.role === 'custom' && (message.display || message.customType === ENTRY_KINDS.subagentMessage))
    )
      return
    const value: RuntimeMessage = {
      id,
      role: message.role === 'custom' ? 'user' : message.role,
      parts: [],
      metadata: {
        completeness,
        inputId: this.inputIds.get(message) ?? this.feed.messageInputId(id)
      }
    }
    const state = completeness === 'complete' ? 'done' : 'streaming'
    if (typeof message.content === 'string') value.parts.push({ type: 'text', text: message.content, state })
    else
      for (const part of message.content) {
        if (part.type === 'text')
          value.parts.push({
            type: 'text',
            text: part.text,
            state,
            ...('textSignature' in part &&
              part.textSignature && { providerMetadata: { pi: { textSignature: part.textSignature } } })
          })
        if (part.type === 'thinking')
          value.parts.push({
            type: 'reasoning',
            text: part.thinking,
            state,
            ...(part.thinkingSignature && { providerMetadata: { pi: { thinkingSignature: part.thinkingSignature } } })
          })
        if (part.type === 'image')
          value.parts.push({ type: 'file', mediaType: part.mimeType, url: `data:${part.mimeType};base64,${part.data}` })
        if (part.type === 'toolCall') {
          this.calls.set(part.id, { id, index: value.parts.length })
          value.parts.push({
            type: 'dynamic-tool',
            toolCallId: part.id,
            toolName: part.name,
            state: completeness === 'complete' ? 'input-available' : 'input-streaming',
            input: part.arguments
          })
        }
      }
    this.publish(value, replaces)
  }

  private async delta(native: CapturedDelta, id: string): Promise<void> {
    const { part, contentIndex: index } = native
    const ref = this.itemRef(id)
    const old = this.feed.part(id, index)
    if (part?.type === 'text' || part?.type === 'thinking') {
      const end = native.type === 'text_end' || native.type === 'thinking_end'
      const text = end ? native.content : part.type === 'text' ? part.text : part.thinking
      if (
        (native.type === 'text_delta' || native.type === 'thinking_delta') &&
        old?.type === (part.type === 'text' ? 'text' : 'reasoning') &&
        old.state === 'streaming' &&
        text.length === old.text.length + native.delta.length
      ) {
        this.feed.publishPart({ type: 'message.text-append', ref, part: index, text: native.delta })
        return
      }
      const changes = textEdits(index, old, {
        type: part.type === 'text' ? 'text' : 'reasoning',
        text,
        state: end ? 'done' : 'streaming',
        ...((old?.type === 'text' || old?.type === 'reasoning') &&
          old.providerMetadata && { providerMetadata: old.providerMetadata })
      })
      if (changes.length) this.feed.publishPart({ type: 'message.parts', ref, changes })
      return
    }
    if (part?.type !== 'toolCall') return
    this.calls.set(part.id, { id, index })
    let input: unknown = part.arguments
    if (native.type === 'toolcall_delta') {
      const json = (this.partialArguments.get(part.id) ?? '') + native.delta
      this.partialArguments.set(part.id, json)
      input = (await parsePartialJson(json)).value
    } else if (native.type === 'toolcall_end') this.partialArguments.delete(part.id)
    this.feed.publishPart({
      type: 'message.parts',
      ref,
      changes: [
        {
          type: 'put',
          part: index,
          value: {
            type: 'dynamic-tool',
            toolCallId: part.id,
            toolName: part.name,
            input,
            state: native.type === 'toolcall_end' ? 'input-available' : 'input-streaming'
          }
        }
      ]
    })
  }

  private async event(event: AgentSessionEvent, context?: PiContext): Promise<void> {
    if (
      event.type === 'message_end' ||
      event.type === 'compaction_end' ||
      event.type === 'agent_settled' ||
      event.type === 'model_select'
    )
      this.feed.publish({ type: 'context.changed', result: readContextUsage(this.session) })
    if (event.type === 'input_settled') {
      const reason = event.aborted ? 'aborted' : event.message.stopReason
      const completed = reason === 'stop' && !event.message.content.some((part) => part.type === 'toolCall')
      for (const inputId of event.inputIds) {
        this.recordInput({
          inputId: runtimeId(inputId),
          facts: [],
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
              message: event.message.errorMessage ?? `Pi response ended: ${reason}`
            }
          })
        })
      }
    }
    if (event.type === 'input_placed') {
      const inputId = runtimeId<'input'>(event.inputId)
      this.inputIds.set(event.message, inputId)
      this.finish(event.message, this.id(event.message), event.entryId)
      this.recordInput({ inputId, nativeInput: { session: this.ref, id: runtimeId(event.entryId) }, facts: ['placed'] })
    }
    if (event.type === 'input_handled') {
      this.recordInput({
        inputId: runtimeId(event.inputId),
        facts: ['locally-handled'],
        ...(event.errorMessage === undefined
          ? {}
          : {
              outcome: 'failed',
              error: { operation: 'input', code: 'command-failed', message: event.errorMessage }
            })
      })
    }
    if (
      (event.type === 'compaction_end' && event.result) ||
      (event.type === 'entry_appended' && (event.entry.type === 'compaction' || event.entry.type === 'context_edit'))
    )
      this.reset(this.session, context)
    if (event.type === 'entry_appended' && event.entry.type === 'custom_message') {
      for (const source of context ?? []) if (source.id === event.entry.id) this.restoreCommitted(source)
    }
    if (event.type === 'message_start' || event.type === 'message_end') {
      const message = event.message
      const id = this.id(message)
      if (event.type === 'message_end')
        this.finish(message, id, this.session.getCommittedEntryId(this.originals.get(message) ?? message))
      else this.write(message, id, 'partial')
      if (event.type === 'message_end' && message.role === 'assistant')
        for (const part of message.content) if (part.type === 'toolCall') this.partialArguments.delete(part.id)
    }
    if (event.type === 'tool_execution_start' && 'parentToolCallId' in event && event.parentToolCallId) {
      this.nested(event.parentToolCallId, {
        type: 'dynamic-tool',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        state: 'input-available',
        input: event.args,
        callProviderMetadata: { pi: { parentToolCallId: event.parentToolCallId, nested: true } }
      })
    }
    if (event.type === 'tool_execution_end' && 'parentToolCallId' in event && event.parentToolCallId)
      this.nested(
        event.parentToolCallId,
        projectNestedTool(
          {
            id: event.toolCallId,
            name: event.toolName,
            parentToolCallId: event.parentToolCallId,
            arguments: event.args,
            result: event.result,
            status: event.isError ? 'error' : 'ok',
            error: event.isError
              ? event.result.content
                  ?.filter((part: { type: string }) => part.type === 'text')
                  .map((part: { text: string }) => part.text)
                  .join('\n')
              : undefined
          },
          providerResult
        )
      )
    if (event.type === 'tool_execution_update') this.result(event)
    if (event.type === 'agent_start' || event.type === 'agent_settled') {
      this.settled = event.type === 'agent_settled'
      this.feed.publish({
        type: 'activity.changed',
        activity: { state: event.type === 'agent_start' ? 'active' : 'idle' }
      })
      this.settled = false
    }
  }
}
