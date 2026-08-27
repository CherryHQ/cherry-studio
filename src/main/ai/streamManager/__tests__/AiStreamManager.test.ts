import {
  ConversationExecutionPhase,
  ConversationInteractionKind,
  ConversationInteractionResumeMode,
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
  ConversationActor,
  ConversationExecutionDriverKind,
  type ConversationExecutionPlan,
  type ConversationExecutionSink,
  ConversationInputProvenance,
  ConversationResponderKind,
  type ConversationRuntimeIdFactory,
  type ConversationRuntimePortSet,
  type ConversationTerminalPersistenceResult,
  ConversationTerminalPersistenceResultKind
} from '../../conversation'
import { ConversationRedirectPhase } from '../../conversation/conversationState'
import { AgentRuntimeRedirectReceiptKind, toAgentRuntimeRedirectId, toAgentRuntimeSegmentId } from '../../runtime/types'

const chat = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const agent = { kind: ConversationKind.Agent, id: 'session-1' } as const

describe('legacy AiStreamManager behavior on Conversation owners', () => {
  let sequence: number
  let sinks: Map<string, ConversationExecutionSink>
  let persistenceResults: ConversationTerminalPersistenceResult[]
  let ports: ConversationRuntimePortSet
  let actors: Map<string, ConversationActor>
  let ids: ConversationRuntimeIdFactory

  const actorFor = (ref: ConversationRef) => {
    const key = `${ref.kind}:${ref.id}`
    let actor = actors.get(key)
    if (!actor) {
      actor = new ConversationActor(ref, () => {}, { ports: { resolve: () => ports }, ids })
      actors.set(key, actor)
    }
    return actor
  }

  const runtime = {
    openTurn: (
      ref: ConversationRef,
      nextInput: ReturnType<typeof input>,
      executions: readonly ConversationExecutionPlan[],
      options: Parameters<ConversationActor['openTurn']>[2]
    ) => actorFor(ref).openTurn([nextInput], executions, options),
    commitInput: (
      ref: ConversationRef,
      nextInput: ReturnType<typeof input>,
      options?: Parameters<ConversationActor['commitInput']>[1]
    ) => actorFor(ref).commitInput(nextInput, options),
    inspect: (ref: ConversationRef) => actorFor(ref).inspect(),
    stop: (ref: ConversationRef, reason: string) => actorFor(ref).stop(reason),
    resolveInteraction: (ref: ConversationRef, interactionId: ReturnType<typeof toConversationInteractionId>) =>
      actorFor(ref).resolveInteraction(interactionId),
    inFlightPersistenceOperations: () => [...actors.values()].flatMap((actor) => actor.inFlightPersistenceOperations()),
    retryBlockedPersistence: () => {
      for (const actor of actors.values()) actor.retryBlockedPersistence()
    }
  }

  const input = (id: string) => ({
    id: toConversationInputId(id),
    historyNodeId: id,
    provenance: ConversationInputProvenance.Renderer,
    responder: ConversationResponderKind.Interactive
  })

  const execution = (id: string, modelId = `provider::${id}`): ConversationExecutionPlan => ({
    id: toConversationExecutionId(id),
    outputNodeId: `assistant-${id}`,
    driver: ConversationExecutionDriverKind.Chat,
    modelId,
    startEffectId: toConversationEffectId(`start-${id}`)
  })

  const open = (ref: ConversationRef = chat, executions = [execution('one')]) =>
    runtime.openTurn(ref, input('user-1'), executions, {
      turnId: toConversationTurnId('turn-1'),
      turnKind: ConversationTurnKind.Submit,
      anchorNodeId: 'user-1'
    })

  beforeEach(() => {
    sequence = 0
    sinks = new Map()
    const durablePersistence: ConversationTerminalPersistenceResult = {
      kind: ConversationTerminalPersistenceResultKind.Durable
    }
    persistenceResults = [durablePersistence]
    ids = {
      turn: () => toConversationTurnId(`turn-${++sequence}`),
      execution: () => toConversationExecutionId(`execution-${++sequence}`),
      effect: () => toConversationEffectId(`effect-${++sequence}`),
      interaction: () => toConversationInteractionId(`interaction-${++sequence}`),
      input: () => toConversationInputId(`input-${++sequence}`)
    }
    ports = {
      terminalPersistence: {
        persistTerminal: vi.fn(async () => persistenceResults.shift() ?? durablePersistence)
      },
      execution: {
        start: vi.fn((effect, sink) => sinks.set(effect.executionId, sink)),
        requestYield: vi.fn(),
        redirect: vi.fn((effect) => ({
          kind: AgentRuntimeRedirectReceiptKind.Queued,
          redirectId: effect.input.redirect.id
        })),
        resume: vi.fn(),
        suspend: vi.fn(() => false),
        resumeSuspended: vi.fn(),
        discardRuntimeBuffer: vi.fn(),
        abort: vi.fn()
      },
      presentation: {
        publishStatus: vi.fn(),
        publishExecutionTerminal: vi.fn(),
        publishTurnTerminal: vi.fn(),
        publishQuiescence: vi.fn()
      },
      scheduleNextTurn: vi.fn(),
      scheduleNextStep: vi.fn(),
      dropInputs: vi.fn(),
      scheduleRuntimeTurn: vi.fn()
    }
    actors = new Map()
  })

  it('creates an execution resource only after the durable turn is committed', () => {
    const transition = open()

    expect(transition.state.phase).toBe(ConversationPhase.Running)
    expect(ports.execution.start).toHaveBeenCalledOnce()
    expect(sinks.has(toConversationExecutionId('one'))).toBe(true)
  })

  it('launches one execution per model in a single call', () => {
    open(chat, [execution('one'), execution('two')])

    expect(ports.execution.start).toHaveBeenCalledTimes(2)
    expect([...sinks.keys()]).toEqual([toConversationExecutionId('one'), toConversationExecutionId('two')])
  })

  it('rejects duplicate execution identities before starting any resource', () => {
    const transition = open(chat, [execution('one'), execution('one')])

    expect(transition.rejection).toBeDefined()
    expect(ports.execution.start).not.toHaveBeenCalled()
  })

  it('routes first chunk status through the aggregate instead of the resource registry', () => {
    open()
    sinks.get(toConversationExecutionId('one'))?.firstChunk()

    const state = runtime.inspect(chat)
    if (state.phase !== ConversationPhase.Running) throw new Error('turn missing')
    expect(state.turn.executions.get(toConversationExecutionId('one'))?.phase).toBe(ConversationExecutionPhase.Active)
    expect(ports.presentation.publishStatus).toHaveBeenCalled()
  })

  it('keeps a live sibling open when another execution terminal persistence fails', async () => {
    persistenceResults = [
      {
        kind: ConversationTerminalPersistenceResultKind.Failed,
        error: { name: 'Error', message: 'database busy', stack: null }
      }
    ]
    open(chat, [execution('one'), execution('two')])
    sinks.get(toConversationExecutionId('one'))?.terminal({ kind: ConversationOutcomeKind.Success })

    await vi.waitFor(() => expect(ports.terminalPersistence.persistTerminal).toHaveBeenCalledOnce())
    const state = runtime.inspect(chat)
    if (state.phase !== ConversationPhase.Running) throw new Error('turn settled early')
    expect(state.turn.executions.get(toConversationExecutionId('one'))?.phase).toBe(
      ConversationExecutionPhase.Persisting
    )
    expect(state.turn.executions.get(toConversationExecutionId('two'))?.phase).toBe(ConversationExecutionPhase.Starting)
    expect(ports.presentation.publishExecutionTerminal).not.toHaveBeenCalled()
    expect(ports.presentation.publishTurnTerminal).not.toHaveBeenCalled()
  })

  it('reports one persistent assistant completion after all models finish', async () => {
    open(chat, [execution('one'), execution('two')])
    sinks.get(toConversationExecutionId('one'))?.terminal({ kind: ConversationOutcomeKind.Success })
    sinks.get(toConversationExecutionId('two'))?.terminal({ kind: ConversationOutcomeKind.Success })

    await vi.waitFor(() => expect(runtime.inspect(chat).phase).toBe(ConversationPhase.Idle))
    expect(ports.presentation.publishExecutionTerminal).toHaveBeenCalledTimes(2)
    expect(ports.presentation.publishTurnTerminal).toHaveBeenCalledOnce()
    expect(ports.presentation.publishQuiescence).toHaveBeenCalledOnce()
  })

  it('waits for terminal persistence before notifying renderer listeners', async () => {
    persistenceResults = [
      {
        kind: ConversationTerminalPersistenceResultKind.Failed,
        error: { name: 'Error', message: 'database busy', stack: null }
      },
      { kind: ConversationTerminalPersistenceResultKind.Durable }
    ]
    open()
    sinks.get(toConversationExecutionId('one'))?.terminal({ kind: ConversationOutcomeKind.Success })
    await vi.waitFor(() => expect(ports.terminalPersistence.persistTerminal).toHaveBeenCalledOnce())

    expect(ports.presentation.publishExecutionTerminal).not.toHaveBeenCalled()
    const [operation] = runtime.inFlightPersistenceOperations()
    let completed = false
    void operation.run.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    runtime.retryBlockedPersistence()
    await operation.run
    await vi.waitFor(() => expect(ports.presentation.publishExecutionTerminal).toHaveBeenCalledOnce())
  })

  it('suppresses the original terminal notification after persistence surfaced an error', async () => {
    persistenceResults = [
      {
        kind: ConversationTerminalPersistenceResultKind.Failed,
        error: { name: 'Error', message: 'write failed', stack: null }
      }
    ]
    open()
    sinks.get(toConversationExecutionId('one'))?.terminal({ kind: ConversationOutcomeKind.Success })

    await vi.waitFor(() => expect(ports.terminalPersistence.persistTerminal).toHaveBeenCalledOnce())
    expect(ports.presentation.publishExecutionTerminal).not.toHaveBeenCalled()
    expect(ports.presentation.publishTurnTerminal).not.toHaveBeenCalled()
    expect(runtime.inspect(chat).phase).toBe(ConversationPhase.Running)
  })

  it('marks an abandoned Stop terminal internal-only and lets the aggregate leave busy', async () => {
    persistenceResults = [
      {
        kind: ConversationTerminalPersistenceResultKind.Abandoned,
        error: { name: 'Error', message: 'database unavailable', stack: null }
      }
    ]
    open()
    runtime.stop(chat, 'user-stop')
    sinks.get(toConversationExecutionId('one'))?.terminal({ kind: ConversationOutcomeKind.Paused, reason: 'user-stop' })

    await vi.waitFor(() => expect(runtime.inspect(chat).phase).toBe(ConversationPhase.Idle))
    expect(ports.presentation.publishExecutionTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        durability: ConversationTerminalDurability.DeferredRecovery,
        audience: 'internal-only'
      })
    )
  })

  it('aborts every exact resource and clears queued future input on Stop', () => {
    open(chat, [execution('one'), execution('two')])
    runtime.commitInput(chat, input('user-2'))
    runtime.stop(chat, 'user-stop')

    expect(ports.execution.abort).toHaveBeenCalledTimes(2)
    expect(runtime.inspect(chat).inbox).toEqual({ nextTurn: [], nextStep: [] })
  })

  it('ignores chunks and terminal callbacks from a replaced runtime execution', async () => {
    open()
    const oldSink = sinks.get(toConversationExecutionId('one'))!
    oldSink.terminal({ kind: ConversationOutcomeKind.Success })
    await vi.waitFor(() => expect(runtime.inspect(chat).phase).toBe(ConversationPhase.Idle))
    vi.mocked(ports.presentation.publishExecutionTerminal).mockClear()

    oldSink.terminal({ kind: ConversationOutcomeKind.Error, error: { name: 'Error', message: 'late', stack: null } })
    expect(ports.presentation.publishExecutionTerminal).not.toHaveBeenCalled()
  })

  it('queues active Chat input in FIFO order and requests yield without restarting the stream', () => {
    open()
    runtime.commitInput(chat, input('user-2'))
    runtime.commitInput(chat, input('user-3'))

    expect(ports.execution.start).toHaveBeenCalledOnce()
    expect(ports.execution.requestYield).toHaveBeenCalledTimes(2)
    expect(runtime.inspect(chat).inbox.nextTurn.map(({ id }) => id)).toEqual([
      toConversationInputId('user-2'),
      toConversationInputId('user-3')
    ])
  })

  it('claims contiguous Chat follow-ups as one ordered successor batch', async () => {
    open()
    runtime.commitInput(chat, input('user-2'))
    runtime.commitInput(chat, input('user-3'))
    sinks.get(toConversationExecutionId('one'))?.terminal({ kind: ConversationOutcomeKind.Success })

    await vi.waitFor(() => expect(ports.scheduleNextTurn).toHaveBeenCalledOnce())
    expect(ports.scheduleNextTurn).toHaveBeenCalledWith(chat, toConversationTurnId('turn-1'), [
      input('user-2'),
      input('user-3')
    ])
  })

  it('keeps an accepted Agent redirect owned until the exact next step commits', async () => {
    open(agent, [{ ...execution('one'), driver: ConversationExecutionDriverKind.Agent }])
    runtime.commitInput(agent, input('user-2'), { runtimeCanRedirect: true })
    actorFor(agent).acceptRedirects([toAgentRuntimeRedirectId('user-2')], toAgentRuntimeSegmentId('segment-user-2'))
    sinks.get(toConversationExecutionId('one'))?.terminal({ kind: ConversationOutcomeKind.Success })

    await vi.waitFor(() => expect(ports.scheduleNextStep).toHaveBeenCalledOnce())
    expect(runtime.inspect(agent).inbox.nextStep).toEqual([
      {
        ...input('user-2'),
        redirect: {
          id: toAgentRuntimeRedirectId('user-2'),
          phase: ConversationRedirectPhase.Delivered,
          segmentId: toAgentRuntimeSegmentId('segment-user-2')
        }
      }
    ])
  })

  it('moves a rejected Agent redirect to the durable NextTurn queue', () => {
    vi.mocked(ports.execution.redirect).mockImplementation((effect) => ({
      kind: AgentRuntimeRedirectReceiptKind.Rejected,
      redirectId: effect.input.redirect.id
    }))
    open(agent, [{ ...execution('one'), driver: ConversationExecutionDriverKind.Agent }])
    runtime.commitInput(agent, input('user-2'), { runtimeCanRedirect: true })

    expect(runtime.inspect(agent).inbox).toEqual({ nextStep: [], nextTurn: [input('user-2')] })
  })

  it('queues a steer that lands after the turn parked on approval, without launching (variant B)', async () => {
    open()
    const sink = sinks.get(toConversationExecutionId('one'))!
    sink.interactionOpened({
      id: toConversationInteractionId('approval-1'),
      executionId: toConversationExecutionId('one'),
      kind: ConversationInteractionKind.ToolApproval,
      resumeMode: ConversationInteractionResumeMode.NewRun
    })
    sink.terminal({ kind: ConversationOutcomeKind.Success })
    await vi.waitFor(() => {
      const state = runtime.inspect(chat)
      if (state.phase !== ConversationPhase.Running) return false
      return (
        state.turn.executions.get(toConversationExecutionId('one'))?.phase ===
        ConversationExecutionPhase.WaitingInteraction
      )
    })

    runtime.commitInput(chat, input('user-2'))
    expect(runtime.inspect(chat).inbox).toEqual({ nextStep: [], nextTurn: [input('user-2')] })
    expect(ports.execution.requestYield).toHaveBeenCalledTimes(0)
  })

  it('does not chain while an execution is awaiting approval', async () => {
    open()
    const sink = sinks.get(toConversationExecutionId('one'))!
    sink.interactionOpened({
      id: toConversationInteractionId('approval-1'),
      executionId: toConversationExecutionId('one'),
      kind: ConversationInteractionKind.ToolApproval,
      resumeMode: ConversationInteractionResumeMode.NewRun
    })
    sink.terminal({ kind: ConversationOutcomeKind.Success })

    await vi.waitFor(() => {
      const state = runtime.inspect(chat)
      return (
        state.phase === ConversationPhase.Running &&
        state.turn.executions.get(toConversationExecutionId('one'))?.phase ===
          ConversationExecutionPhase.WaitingInteraction
      )
    })
    runtime.commitInput(chat, input('user-2'))

    expect(ports.scheduleNextTurn).not.toHaveBeenCalled()
    expect(runtime.inspect(chat).inbox.nextTurn).toEqual([input('user-2')])
  })

  it('onExecutionDone while awaiting approval keeps awaiting-approval (MCP continue)', async () => {
    open()
    const sink = sinks.get(toConversationExecutionId('one'))!
    sink.interactionOpened({
      id: toConversationInteractionId('approval-1'),
      executionId: toConversationExecutionId('one'),
      kind: ConversationInteractionKind.ToolApproval,
      resumeMode: ConversationInteractionResumeMode.NewRun
    })
    sink.terminal({ kind: ConversationOutcomeKind.Success })

    await vi.waitFor(() => {
      const state = runtime.inspect(chat)
      return (
        state.phase === ConversationPhase.Running &&
        state.turn.executions.get(toConversationExecutionId('one'))?.phase ===
          ConversationExecutionPhase.WaitingInteraction
      )
    })
    const state = runtime.inspect(chat)
    if (state.phase !== ConversationPhase.Running) throw new Error('approval turn was not retained')
    expect(state.turn.interactions.has(toConversationInteractionId('approval-1'))).toBe(true)
    expect(ports.presentation.publishTurnTerminal).not.toHaveBeenCalled()
  })

  it('drops a queued steer when the turn is aborted instead of chaining onto it', async () => {
    open()
    runtime.commitInput(chat, input('user-2'))
    runtime.stop(chat, 'user-stop')
    sinks.get(toConversationExecutionId('one'))?.terminal({
      kind: ConversationOutcomeKind.Paused,
      reason: 'user-stop'
    })

    await vi.waitFor(() => expect(runtime.inspect(chat).phase).toBe(ConversationPhase.Idle))
    expect(ports.dropInputs).toHaveBeenCalledWith(chat, [input('user-2')])
    expect(ports.scheduleNextTurn).not.toHaveBeenCalled()
  })

  it('drops — does not chain — a steer that lands after an aborted settle (Stop race)', () => {
    open()
    runtime.stop(chat, 'user-stop')

    const late = runtime.commitInput(chat, input('user-2'))

    expect(late.rejection).toBeDefined()
    expect(runtime.inspect(chat).inbox).toEqual({ nextTurn: [], nextStep: [] })
    expect(ports.scheduleNextTurn).not.toHaveBeenCalled()
  })

  it('resumes a Chat approval by starting a new exact run', async () => {
    open()
    const sink = sinks.get(toConversationExecutionId('one'))!
    sink.interactionOpened({
      id: toConversationInteractionId('approval-1'),
      executionId: toConversationExecutionId('one'),
      kind: ConversationInteractionKind.ToolApproval,
      resumeMode: ConversationInteractionResumeMode.NewRun
    })
    sink.terminal({ kind: ConversationOutcomeKind.Success })
    await vi.waitFor(() => expect(ports.terminalPersistence.persistTerminal).toHaveBeenCalledOnce())
    vi.mocked(ports.execution.start).mockClear()

    runtime.resolveInteraction(chat, toConversationInteractionId('approval-1'))
    expect(ports.execution.start).toHaveBeenCalledOnce()
  })

  it('resumes an Agent approval in place instead of creating another resource', () => {
    open(agent, [{ ...execution('one'), driver: ConversationExecutionDriverKind.Agent }])
    sinks.get(toConversationExecutionId('one'))?.interactionOpened({
      id: toConversationInteractionId('approval-1'),
      executionId: toConversationExecutionId('one'),
      kind: ConversationInteractionKind.ToolApproval,
      resumeMode: ConversationInteractionResumeMode.InPlace
    })
    vi.mocked(ports.execution.start).mockClear()

    runtime.resolveInteraction(agent, toConversationInteractionId('approval-1'))
    expect(ports.execution.resume).toHaveBeenCalledOnce()
    expect(ports.execution.start).not.toHaveBeenCalled()
  })

  it('rebroadcasts awaiting-approval anchors when a live stream pauses and resumes for tool approval', () => {
    open(agent, [{ ...execution('one'), driver: ConversationExecutionDriverKind.Agent }])
    const sink = sinks.get(toConversationExecutionId('one'))!
    sink.interactionOpened({
      id: toConversationInteractionId('approval-1'),
      executionId: toConversationExecutionId('one'),
      kind: ConversationInteractionKind.ToolApproval,
      resumeMode: ConversationInteractionResumeMode.InPlace
    })
    expect(ports.presentation.publishStatus).toHaveBeenCalledOnce()
    vi.mocked(ports.presentation.publishStatus).mockClear()

    runtime.resolveInteraction(agent, toConversationInteractionId('approval-1'))

    expect(ports.presentation.publishStatus).toHaveBeenCalledOnce()
    const state = runtime.inspect(agent)
    if (state.phase !== ConversationPhase.Running) throw new Error('Agent approval turn disappeared')
    expect(state.turn.interactions.size).toBe(0)
    expect(state.turn.executions.get(toConversationExecutionId('one'))?.phase).toBe(ConversationExecutionPhase.Active)
  })
})
