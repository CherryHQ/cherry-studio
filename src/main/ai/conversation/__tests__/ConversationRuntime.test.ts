import {
  ConversationExecutionPhase,
  ConversationKind,
  ConversationOutcomeKind,
  ConversationPhase,
  type ConversationRef,
  ConversationTerminalDurability,
  ConversationTurnKind,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationInputId,
  toConversationInteractionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ConversationExecutionDriverKind,
  type ConversationExecutionSink,
  ConversationInputProvenance,
  ConversationResponderKind,
  ConversationRuntime,
  type ConversationRuntimeIdFactory,
  type ConversationRuntimePortSet,
  type ConversationTerminalPersistenceResult,
  ConversationTerminalPersistenceResultKind
} from '..'

const chat = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const agent = { kind: ConversationKind.Agent, id: 'session-1' } as const

describe('ConversationRuntime', () => {
  let sequence: number
  let sinks: ConversationExecutionSink[]
  let ports: ConversationRuntimePortSet
  let runtime: ConversationRuntime

  beforeEach(() => {
    sequence = 0
    sinks = []
    const ids: ConversationRuntimeIdFactory = {
      turn: () => toConversationTurnId(`turn-${++sequence}`),
      execution: () => toConversationExecutionId(`execution-${++sequence}`),
      effect: () => toConversationEffectId(`effect-${++sequence}`),
      interaction: () => toConversationInteractionId(`interaction-${++sequence}`),
      input: () => toConversationInputId(`input-${++sequence}`)
    }
    ports = {
      terminalPersistence: {
        persistTerminal: vi.fn(
          async (): Promise<ConversationTerminalPersistenceResult> => ({
            kind: ConversationTerminalPersistenceResultKind.Durable
          })
        )
      },
      execution: {
        start: vi.fn((_effect, sink) => sinks.push(sink)),
        requestYield: vi.fn(),
        redirect: vi.fn(() => true),
        resume: vi.fn(),
        abort: vi.fn()
      },
      presentation: {
        publishStatus: vi.fn(),
        publishExecutionTerminal: vi.fn(),
        publishTurnTerminal: vi.fn(),
        publishQuiescence: vi.fn()
      },
      scheduleNextTurn: vi.fn(),
      scheduleNextStep: vi.fn()
    }
    runtime = new ConversationRuntime({ resolve: () => ports }, ids)
  })

  function open(ref: ConversationRef = chat) {
    return runtime.openTurn(
      ref,
      {
        id: toConversationInputId('user-1'),
        historyNodeId: 'user-1',
        provenance: ConversationInputProvenance.Renderer,
        responder: ConversationResponderKind.Interactive
      },
      [
        {
          id: toConversationExecutionId('execution-1'),
          outputNodeId: 'assistant-1',
          driver:
            ref.kind === ConversationKind.Chat
              ? ConversationExecutionDriverKind.Chat
              : ConversationExecutionDriverKind.Agent,
          modelId: 'provider::model',
          startEffectId: toConversationEffectId('start-1')
        }
      ],
      { turnId: toConversationTurnId('turn-1'), turnKind: ConversationTurnKind.Submit }
    )
  }

  it('starts resources only from an already-committed Starting execution', () => {
    const transition = open()

    expect(transition.state.phase).toBe(ConversationPhase.Running)
    if (transition.state.phase !== ConversationPhase.Running) throw new Error('turn did not open')
    expect(transition.state.turn.executions.get(toConversationExecutionId('execution-1'))?.phase).toBe(
      ConversationExecutionPhase.Starting
    )
    expect(ports.execution.start).toHaveBeenCalledOnce()
  })

  it('routes first chunk and durable terminal results back through exact identities', async () => {
    open()
    sinks[0]?.firstChunk()
    const active = runtime.inspect(chat)
    if (active.phase !== ConversationPhase.Running) throw new Error('turn missing')
    expect(active.turn.executions.get(toConversationExecutionId('execution-1'))?.phase).toBe(
      ConversationExecutionPhase.Active
    )

    sinks[0]?.terminal({ kind: ConversationOutcomeKind.Success })
    await vi.waitFor(() => expect(runtime.inspect(chat).phase).toBe(ConversationPhase.Idle))
    expect(ports.presentation.publishExecutionTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ durability: ConversationTerminalDurability.Durable })
    )
    expect(ports.presentation.publishQuiescence).toHaveBeenCalledOnce()
  })

  it('keeps a rejected Agent redirect as a future turn owned by the aggregate', () => {
    vi.mocked(ports.execution.redirect).mockReturnValue(false)
    open(agent)
    runtime.commitInput(
      agent,
      {
        id: toConversationInputId('user-2'),
        historyNodeId: 'user-2',
        provenance: ConversationInputProvenance.Renderer,
        responder: ConversationResponderKind.Interactive
      },
      { runtimeCanRedirect: true }
    )

    const state = runtime.inspect(agent)
    expect(state.inbox.nextStep).toEqual([])
    expect(state.inbox.nextTurn.map(({ id }) => id)).toEqual([toConversationInputId('user-2')])
  })

  it('schedules an accepted Agent NextStep only after the predecessor is durable', async () => {
    open(agent)
    runtime.commitInput(
      agent,
      {
        id: toConversationInputId('user-2'),
        historyNodeId: 'user-2',
        provenance: ConversationInputProvenance.Renderer,
        responder: ConversationResponderKind.Interactive
      },
      { runtimeCanRedirect: true }
    )
    sinks[0]?.terminal({ kind: ConversationOutcomeKind.Success })

    await vi.waitFor(() => expect(ports.scheduleNextStep).toHaveBeenCalledOnce())
    expect(runtime.inspect(agent).phase).toBe(ConversationPhase.Running)
  })

  it('Stop interrupts Starting resources without a preparation cancellation protocol', () => {
    open()
    runtime.stop(chat, 'user-stop')

    expect(runtime.inspect(chat).phase).toBe(ConversationPhase.Stopping)
    expect(ports.execution.abort).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: toConversationExecutionId('execution-1'), reason: 'user-stop' })
    )
  })
})
