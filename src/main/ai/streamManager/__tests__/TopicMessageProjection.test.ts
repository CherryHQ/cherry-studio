import { afterEach, expect, expectTypeOf, it, vi } from 'vitest'

import { cloneObservationValue } from '@cherrystudio/agent-runtime'
import type { RootMessageProjection } from '@main/ai/agentSession/RootMessageProjection'
import type { MessageProjection } from '@main/ai/messages/MessageProjection'
import type { AgentControlChunk, AgentRuntimeEvent } from '@main/ai/runtime/types'
import type { projectAgentNonTextPart } from '@main/utils/messageOutputProjection'
import type {
  ChildProjectionState,
  LivePartPatch,
  MessageProjectionUpdate,
  ProjectedExecution,
  TimelinePlacement,
  TopicProjectionState
} from '@shared/ai/messageProjection'
import type { CherryUIMessage } from '@shared/data/types/message'

import type { PersistenceBackend } from '../persistence/PersistenceBackend'
import type { pipeMessageStream } from '../pipeMessageStream'
import { TopicMessageProjection } from '../TopicMessageProjection'
import type { AgentPartChange, StreamListener } from '../types'

const message = (text: string): CherryUIMessage => ({
  id: 'native',
  role: 'assistant',
  parts: [{ type: 'text', text, state: 'streaming' }]
})
afterEach(() => vi.useRealTimers())

it('requires a committed row identity from each durable write and forbids it on live or unresolved executions', () => {
  expectTypeOf<() => void>().not.toExtend<PersistenceBackend<'sqlite'>['persistAssistant']>()
  expectTypeOf<() => { messageId: string }>().not.toExtend<PersistenceBackend<'agents-db'>['persistAssistant']>()
  expectTypeOf<() => { messageId: string }>().not.toExtend<PersistenceBackend<'temp'>['persistAssistant']>()
  expectTypeOf<{
    executionId: 'p::m'
    attemptId: number
    status: 'active' | 'unresolved'
    savedMessageId: string
  }>().not.toExtend<ProjectedExecution>()
})

it('requires projected tool results and separate control, snapshot and part handlers', () => {
  type RootPublication = Parameters<TopicMessageProjection['relayAgentPart']>[2]
  type ChildPublication = Parameters<MessageProjection<ChildProjectionState>['publishParts']>[0][number]
  type RawResult = Extract<AgentPartChange, { type: 'part-put' }>
  type Append = Extract<LivePartPatch, { type: 'part-append' }>
  type Content = NonNullable<StreamListener['content']>
  expectTypeOf<RawResult>().not.toExtend<RootPublication>()
  expectTypeOf<RawResult>().not.toExtend<ChildPublication>()
  expectTypeOf<ReturnType<typeof projectAgentNonTextPart<TimelinePlacement>>['patch']>().toExtend<RootPublication>()
  expectTypeOf<
    Parameters<MessageProjection<TopicProjectionState>['publishParts']>[0][number]
  >().toEqualTypeOf<RootPublication>()
  type Open = Extract<AgentPartChange, { type: 'part-open' }>
  type SourceOpen = Omit<Open, 'pos' | 'afterPartId'> & { afterPartId: string }
  expectTypeOf<Omit<Open, 'pos'>>().not.toExtend<AgentPartChange>()
  type TopicFrame = Extract<MessageProjectionUpdate, { kind: 'topic'; type: 'parts' }>
  expectTypeOf<
    Omit<TopicFrame, 'patches'> & { patches: readonly SourceOpen[] }
  >().not.toExtend<MessageProjectionUpdate>()
  expectTypeOf<SourceOpen>().not.toExtend<RootPublication>()
  expectTypeOf<SourceOpen & { pos: number }>().not.toExtend<RootPublication>()
  expectTypeOf<Omit<RawResult, 'placement'> & { placement: TimelinePlacement }>().not.toExtend<AgentPartChange>()
  expectTypeOf<Omit<Append, 'pos'> & { pos: number }>().not.toExtend<AgentPartChange>()
  expectTypeOf<Omit<RawResult, 'archiveMessageId'>>().not.toExtend<Parameters<typeof projectAgentNonTextPart>[1]>()
  expectTypeOf<{
    type: 'part-append'
    partId: string
    text: string
    part: RawResult['part']
  }>().not.toExtend<AgentPartChange>()
  expectTypeOf<Pick<Content, 'snapshot'>>().not.toExtend<Content>()
  expectTypeOf<Parameters<Parameters<typeof pipeMessageStream>[3]>[0]['partIds']>().toEqualTypeOf<string[]>()
  expectTypeOf<Parameters<Parameters<typeof pipeMessageStream>[5]>>().toEqualTypeOf<[change: AgentPartChange]>()
  expectTypeOf<Parameters<typeof pipeMessageStream>['length']>().toEqualTypeOf<6>()
  expectTypeOf<Extract<AgentRuntimeEvent, { type: 'chunk' }>>().toBeNever()
  expectTypeOf<{
    type: 'message-metadata'
    messageMetadata: { stats: { totalTokens: number }; status: 'success' }
  }>().not.toExtend<AgentRuntimeEvent>()
  expectTypeOf<Extract<AgentControlChunk, AgentRuntimeEvent>['type']>().toEqualTypeOf<
    'message-metadata' | 'tool-input-available' | 'data-retry'
  >()
  expectTypeOf<Exclude<AgentControlChunk, AgentRuntimeEvent>['type']>().toEqualTypeOf<
    'start' | 'tool-approval-request' | 'data-agent-task-event' | 'data-compaction-anchor'
  >()
  expectTypeOf<Extract<AgentControlChunk, { type: 'message-metadata' }>>().not.toExtend<
    Parameters<RootMessageProjection['control']>[1]
  >()
  expectTypeOf<
    Extract<AgentControlChunk, { type: 'text-delta' | 'reasoning-delta' | 'tool-output-available' }>
  >().toBeNever()
  expectTypeOf<
    TopicProjectionState & { type: 'parts'; revision: number; patches: [Append] }
  >().not.toExtend<MessageProjectionUpdate>()
  expectTypeOf<
    TopicProjectionState & { revision: number; patches: [Append]; order: string[] }
  >().not.toExtend<MessageProjectionUpdate>()
  expectTypeOf<
    TopicProjectionState & { revision: number; patches: [Append, { type: 'message'; message: CherryUIMessage }] }
  >().not.toExtend<MessageProjectionUpdate>()
})

it('publishes a suffix by part ID and includes it in the next attach baseline', () => {
  const projection = new TopicMessageProjection('topic', (value) => value)
  projection.begin([{ executionId: 'p::a', attemptId: 1, anchorMessageId: 'reply' }], true)
  const content = (text: string) => ({ ...message(text), partIds: ['stable-part'] })
  let owned = content('First')
  let reads = 0
  projection.readAgentFrom('p::a', 1, () => {
    reads++
    return owned
  })
  projection.accumulate('p::a', 1, owned)
  const baseline = projection.snapshot()
  const updates: MessageProjectionUpdate<TopicProjectionState>[] = []
  projection.subscribe((update) => updates.push(update))
  owned = content('First suf')
  projection.relayAgentPart('p::a', 1, { type: 'part-append', partId: 'stable-part', text: ' suf' })
  owned = content('First suffix')
  projection.relayAgentPart('p::a', 1, { type: 'part-append', partId: 'stable-part', text: 'fix' })
  expect(reads).toBe(1)
  const next = projection.snapshot()
  expect(updates.map(({ patches, order }) => ({ patches, order }))).toEqual([
    { patches: [{ type: 'part-append', partId: 'stable-part', text: ' suffix' }] }
  ])
  expect(baseline.messages[0].parts[0]).toMatchObject({ text: 'First' })
  expect(next.revision).toBe(updates[0].revision)
  expect(next.messages[0].parts[0]).toMatchObject({ text: 'First suffix' })
  projection.dispose()
})

// A retry may reuse both model and message IDs; late frames/terminals must still be rejected.
it('fences attempt replacement and preserves independently running siblings', () => {
  vi.useFakeTimers()
  const projection = new TopicMessageProjection('topic', (value) => value)
  projection.begin(
    [
      { executionId: 'p::a', attemptId: 1, anchorMessageId: 'a' },
      { executionId: 'p::b', attemptId: 2, anchorMessageId: 'b' }
    ],
    true
  )
  projection.accumulate('p::a', 1, message('old'))
  projection.accumulate('p::b', 2, message('sibling'))
  projection.begin([{ executionId: 'p::a', attemptId: 3, anchorMessageId: 'a' }], false)
  projection.accumulate('p::a', 3, message('new'))
  projection.onDone({ status: 'success', modelId: 'p::a', attemptId: 1, finalMessage: message('stale') })
  projection.accumulate('p::a', 1, message('stale chunk'))
  const view = projection.snapshot()
  expect(view.messages.map((item) => [item.id, item.parts[0]])).toEqual([
    ['b', expect.objectContaining({ text: 'sibling' })],
    ['a', expect.objectContaining({ text: 'new' })]
  ])
  expect(view.executions.map((execution) => [execution.attemptId, execution.status])).toEqual([
    [3, 'active'],
    [2, 'active']
  ])
  projection.dispose()
})

// Terminal publication must contain all accepted text even when its coalescing timer has not fired.
it.each(['success', 'paused', 'error'] as const)('flushes the final message with %s state', (status) => {
  vi.useFakeTimers()
  const projection = new TopicMessageProjection('topic', (value) => value)
  projection.begin([{ executionId: 'p::a', attemptId: 1, anchorMessageId: 'a' }], true)
  projection.accumulate('p::a', 1, message('complete text'))
  const result = {
    modelId: 'p::a' as const,
    attemptId: 1,
    userMessageId: 'queued-user',
    finalMessage: message('complete text')
  }
  if (status === 'success') projection.onDone({ ...result, status })
  else if (status === 'paused') projection.onPaused({ ...result, status })
  else projection.onError({ ...result, status, error: { name: 'Error', message: 'provider failed', stack: '' } })
  const view = projection.snapshot()
  expect(view.messages[0].parts[0]).toMatchObject({ text: 'complete text' })
  expect(view.executions[0].status).toBe(status === 'success' ? 'done' : status)
  expect(view.executions[0]).toMatchObject({ userMessageId: 'queued-user' })
  if (status === 'error') expect(view.messages[0].parts.at(-1)).toMatchObject({ type: 'data-error' })
  projection.dispose()
})

// Acceptance must detach mutable native messages before coalescing; later mutation is not an accepted frame.
it('publishes only accepted snapshots and leaves earlier batches immutable', () => {
  vi.useFakeTimers()
  const projection = new TopicMessageProjection('topic', (value) => cloneObservationValue(value))
  projection.begin([{ executionId: 'p::a', attemptId: 1, anchorMessageId: 'a' }], true)
  const source = message('accepted')
  projection.accumulate('p::a', 1, source)
  source.parts.splice(0, 1, { type: 'text', text: 'unaccepted mutation' })
  const baseline = projection.snapshot()
  expect(baseline.messages[0]).toMatchObject({ id: 'a', parts: [{ text: 'accepted' }] })
  projection.accumulate('p::a', 1, source)
  expect(projection.snapshot().messages[0]).toMatchObject({ parts: [{ text: 'unaccepted mutation' }] })
  expect(baseline.messages[0]).toMatchObject({ parts: [{ text: 'accepted' }] })
  projection.dispose()
})
