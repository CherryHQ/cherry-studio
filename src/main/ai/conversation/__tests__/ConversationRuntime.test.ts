import {
  ConversationAdmissionReason,
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

import { AgentRuntimeRedirectReceiptKind, toAgentRuntimeRedirectId, toAgentRuntimeSegmentId } from '../../runtime/types'
import {
  ConversationActor,
  ConversationAdmissionOperationKind,
  ConversationExecutionAbortResultKind,
  ConversationExecutionAdmissionKind,
  ConversationExecutionDriverKind,
  type ConversationExecutionSink,
  ConversationHistoryCommitKind,
  ConversationInputProvenance,
  ConversationResponderKind,
  ConversationRunMode,
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
  let actors: Map<string, ConversationActor>
  let effectSchedulingPaused: boolean

  const actorFor = (ref: ConversationRef) => {
    const key = `${ref.kind}:${ref.id}`
    let actor = actors.get(key)
    if (!actor) {
      actor = new ConversationActor(ref, () => {}, {
        ports: { resolve: () => ports },
        ids,
        isEffectSchedulingPaused: () => effectSchedulingPaused
      })
      actors.set(key, actor)
    }
    return actor
  }

  let ids: ConversationRuntimeIdFactory

  beforeEach(() => {
    sequence = 0
    effectSchedulingPaused = false
    sinks = []
    ids = {
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
        redirect: vi.fn((effect) => ({
          kind: AgentRuntimeRedirectReceiptKind.Queued,
          redirectId: effect.input.redirect.id
        })),
        resume: vi.fn(),
        suspend: vi.fn(() => false),
        resumeSuspended: vi.fn(),
        discardRuntimeBuffer: vi.fn(),
        abort: vi.fn((effect) => ({
          completed: Promise.resolve({
            kind: ConversationExecutionAbortResultKind.Completed as const,
            conversation: effect.conversation,
            turnId: effect.turnId,
            executionId: effect.executionId,
            effectId: effect.effectId
          })
        }))
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

  function open(ref: ConversationRef = chat) {
    return actorFor(ref).openTurn(
      [
        {
          id: toConversationInputId('user-1'),
          historyNodeId: 'user-1',
          provenance: ConversationInputProvenance.Renderer,
          responder: ConversationResponderKind.Interactive
        }
      ],
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

  it('keeps dispatch classification and identity reservation inside the Actor without mutating state', () => {
    const actor = actorFor(chat)
    const reservation = actor.reserveDispatch({
      turnKind: ConversationTurnKind.Submit,
      anchorNodeId: null,
      responder: ConversationResponderKind.Interactive,
      executionModelIds: ['provider::model'],
      runtimeCanRedirect: false
    })

    expect(reservation.kind).toBe(ConversationHistoryCommitKind.FreshTurn)
    expect(actor.inspect().phase).toBe(ConversationPhase.Idle)
  })

  it('rejects a synchronous admission commit after Stop supersedes its operation', async () => {
    let releaseValidation!: () => void
    const validation = new Promise<void>((resolve) => {
      releaseValidation = resolve
    })
    const commit = vi.fn(() => 'committed')
    const actor = actorFor(chat)
    const admission = actor.enqueue(ConversationAdmissionOperationKind.Dispatch, async (operation) => {
      await validation
      return operation.commit(commit)
    })

    await Promise.resolve()
    const stop = actor.stop('user-stop')
    releaseValidation()

    await expect(admission).rejects.toThrow('superseded')
    await expect(stop.completed).resolves.toBeUndefined()
    expect(commit).not.toHaveBeenCalled()
  })

  it('rejects a duplicate live model from the Actor admission preview', () => {
    open()

    expect(() =>
      actorFor(chat).reserveDispatch({
        turnKind: ConversationTurnKind.Regenerate,
        anchorNodeId: 'user-1',
        responder: ConversationResponderKind.Interactive,
        executionModelIds: ['provider::model'],
        executionMutation: {
          kind: ConversationExecutionAdmissionKind.Append,
          outputNodeId: 'missing-assistant',
          persistedSiblingsGroupId: 1
        },
        runtimeCanRedirect: false
      })
    ).toThrow(expect.objectContaining({ reason: ConversationAdmissionReason.ModelAlreadyInLiveGroup }))
  })

  it('routes first chunk and durable terminal results back through exact identities', async () => {
    open()
    sinks[0]?.firstChunk()
    const active = actorFor(chat).inspect()
    if (active.phase !== ConversationPhase.Running) throw new Error('turn missing')
    expect(active.turn.executions.get(toConversationExecutionId('execution-1'))?.phase).toBe(
      ConversationExecutionPhase.Active
    )

    sinks[0]?.terminal({ kind: ConversationOutcomeKind.Success })
    await vi.waitFor(() => expect(actorFor(chat).inspect().phase).toBe(ConversationPhase.Idle))
    expect(ports.presentation.publishExecutionTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ durability: ConversationTerminalDurability.Durable })
    )
    expect(ports.presentation.publishQuiescence).toHaveBeenCalledOnce()
  })

  it('keeps a rejected Agent redirect as a future turn owned by the aggregate', () => {
    vi.mocked(ports.execution.redirect).mockImplementation((effect) => ({
      kind: AgentRuntimeRedirectReceiptKind.Rejected,
      redirectId: effect.input.redirect.id
    }))
    open(agent)
    actorFor(agent).commitInput(
      {
        id: toConversationInputId('user-2'),
        historyNodeId: 'user-2',
        provenance: ConversationInputProvenance.Renderer,
        responder: ConversationResponderKind.Interactive
      },
      { runtimeCanRedirect: true }
    )

    const state = actorFor(agent).inspect()
    expect(state.inbox.nextStep).toEqual([])
    expect(state.inbox.nextTurn.map(({ id }) => id)).toEqual([toConversationInputId('user-2')])
  })

  it('schedules an accepted Agent NextStep only after the predecessor is durable', async () => {
    open(agent)
    actorFor(agent).commitInput(
      {
        id: toConversationInputId('user-2'),
        historyNodeId: 'user-2',
        provenance: ConversationInputProvenance.Renderer,
        responder: ConversationResponderKind.Interactive
      },
      { runtimeCanRedirect: true }
    )
    actorFor(agent).acceptRedirects([toAgentRuntimeRedirectId('user-2')], toAgentRuntimeSegmentId('segment-user-2'))
    sinks[0]?.terminal({ kind: ConversationOutcomeKind.Success })

    await vi.waitFor(() => expect(ports.scheduleNextStep).toHaveBeenCalledOnce())
    expect(actorFor(agent).inspect().phase).toBe(ConversationPhase.Running)
  })

  it('Stop interrupts Starting resources and completes only after teardown and persistence', async () => {
    let completeAbort!: () => void
    const abortCompleted = new Promise<void>((resolve) => {
      completeAbort = resolve
    })
    vi.mocked(ports.execution.abort).mockImplementation((effect) => {
      sinks[0]?.terminal({ kind: ConversationOutcomeKind.Paused, reason: effect.reason })
      return {
        completed: abortCompleted.then(() => ({
          kind: ConversationExecutionAbortResultKind.Completed as const,
          conversation: effect.conversation,
          turnId: effect.turnId,
          executionId: effect.executionId,
          effectId: effect.effectId
        }))
      }
    })
    open()
    const handle = actorFor(chat).stop('user-stop')

    expect(actorFor(chat).inspect().phase).toBe(ConversationPhase.Stopping)
    expect(ports.execution.abort).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: toConversationExecutionId('execution-1'), reason: 'user-stop' })
    )
    let completed = false
    void handle.completed.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    completeAbort()
    await vi.waitFor(() => expect(actorFor(chat).inspect().phase).toBe(ConversationPhase.Idle))
    await expect(handle.completed).resolves.toBeUndefined()
    expect(actorFor(chat).inspect().phase).toBe(ConversationPhase.Idle)
  })

  it('drains an execution whose immutable terminal is already persisting', async () => {
    let finishPersistence!: () => void
    const persistenceGate = new Promise<void>((resolve) => {
      finishPersistence = resolve
    })
    vi.mocked(ports.terminalPersistence.persistTerminal).mockImplementation(async () => {
      await persistenceGate
      return { kind: ConversationTerminalPersistenceResultKind.Durable }
    })
    open(agent)
    sinks[0]?.terminal({ kind: ConversationOutcomeKind.Success })
    await vi.waitFor(() => {
      const state = actorFor(agent).inspect()
      if (state.phase !== ConversationPhase.Running) throw new Error('turn did not remain active')
      expect(state.turn.executions.get(toConversationExecutionId('execution-1'))?.phase).toBe(
        ConversationExecutionPhase.Persisting
      )
    })

    const stop = actorFor(agent).stop('user-stop')

    expect(ports.execution.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: toConversationTurnId('turn-1'),
        executionId: toConversationExecutionId('execution-1')
      })
    )
    finishPersistence()
    await expect(stop.completed).resolves.toBeUndefined()
    expect(actorFor(agent).inspect()).toMatchObject({
      phase: ConversationPhase.Idle,
      lastTurnId: toConversationTurnId('turn-1')
    })
  })

  it('holds post-Stop admission behind the exact teardown barrier', async () => {
    let completeAbort!: () => void
    const abortCompleted = new Promise<void>((resolve) => {
      completeAbort = resolve
    })
    vi.mocked(ports.execution.abort).mockImplementation((effect) => {
      sinks[0]?.terminal({ kind: ConversationOutcomeKind.Paused, reason: effect.reason })
      return {
        completed: abortCompleted.then(() => ({
          kind: ConversationExecutionAbortResultKind.Completed as const,
          conversation: effect.conversation,
          turnId: effect.turnId,
          executionId: effect.executionId,
          effectId: effect.effectId
        }))
      }
    })
    open()
    const handle = actorFor(chat).stop('user-stop')
    const admission = vi.fn(() => 'started')
    const retry = actorFor(chat).enqueue(ConversationAdmissionOperationKind.Dispatch, admission)
    const repeated = actorFor(chat).stop('user-stop-again')

    await Promise.resolve()
    expect(admission).not.toHaveBeenCalled()
    expect(repeated.operationId).toBe(handle.operationId)
    completeAbort()
    await vi.waitFor(() => expect(actorFor(chat).inspect().phase).toBe(ConversationPhase.Idle))
    await handle.completed
    await expect(retry).resolves.toBe('started')
    expect(admission).toHaveBeenCalledOnce()
  })

  it('joins repeated Stop calls to the current turn operation', async () => {
    open()
    sinks[0]?.terminal({ kind: ConversationOutcomeKind.Success })
    await vi.waitFor(() => expect(actorFor(chat).inspect().phase).toBe(ConversationPhase.Idle))

    actorFor(chat).openTurn(
      [
        {
          id: toConversationInputId('user-2'),
          historyNodeId: 'user-2',
          provenance: ConversationInputProvenance.Renderer,
          responder: ConversationResponderKind.Interactive
        }
      ],
      [
        {
          id: toConversationExecutionId('execution-2'),
          outputNodeId: 'assistant-2',
          driver: ConversationExecutionDriverKind.Chat,
          modelId: 'provider::model',
          startEffectId: toConversationEffectId('start-2')
        }
      ],
      { turnId: toConversationTurnId('turn-2'), turnKind: ConversationTurnKind.Submit }
    )
    vi.mocked(ports.execution.abort).mockImplementation((effect) => {
      sinks[1]?.terminal({ kind: ConversationOutcomeKind.Paused, reason: effect.reason })
      return {
        completed: Promise.resolve({
          kind: ConversationExecutionAbortResultKind.Completed as const,
          conversation: effect.conversation,
          turnId: effect.turnId,
          executionId: effect.executionId,
          effectId: effect.effectId
        })
      }
    })

    const first = actorFor(chat).stop('user-stop')
    const repeated = actorFor(chat).stop('user-stop-again')

    expect(first.operationId).toBe(repeated.operationId)
    expect(first.completed).toBe(repeated.completed)
    expect(ports.execution.abort).toHaveBeenLastCalledWith(
      expect.objectContaining({ turnId: toConversationTurnId('turn-2') })
    )
    await expect(first.completed).resolves.toBeUndefined()
  })

  it('fails closed when exact execution teardown fails', async () => {
    vi.mocked(ports.execution.abort).mockImplementation((effect) => {
      sinks[0]?.terminal({ kind: ConversationOutcomeKind.Paused, reason: effect.reason })
      return {
        completed: Promise.resolve({
          kind: ConversationExecutionAbortResultKind.Failed as const,
          conversation: effect.conversation,
          turnId: effect.turnId,
          executionId: effect.executionId,
          effectId: effect.effectId,
          error: { name: 'CloseError', message: 'close failed', stack: null }
        })
      }
    })
    open()
    const handle = actorFor(chat).stop('user-stop')
    const retry = actorFor(chat).enqueue(ConversationAdmissionOperationKind.Dispatch, () => 'started')

    await expect(handle.completed).rejects.toThrow('close failed')
    await expect(retry).rejects.toThrow('close failed')
    await expect(actorFor(chat).enqueue(ConversationAdmissionOperationKind.Dispatch, () => 'recovered')).resolves.toBe(
      'recovered'
    )
  })

  it('fails closed when execution teardown returns another effect identity', async () => {
    vi.mocked(ports.execution.abort).mockImplementation((effect) => {
      sinks[0]?.terminal({ kind: ConversationOutcomeKind.Paused, reason: effect.reason })
      return {
        completed: Promise.resolve({
          kind: ConversationExecutionAbortResultKind.Completed as const,
          conversation: effect.conversation,
          turnId: effect.turnId,
          executionId: effect.executionId,
          effectId: toConversationEffectId('another-abort')
        })
      }
    })
    open()

    await expect(actorFor(chat).stop('user-stop').completed).rejects.toThrow('stale identity')
  })

  it('defers an exact foreground resume while effect scheduling is paused and flushes it once', () => {
    vi.mocked(ports.execution.suspend).mockReturnValue(true)
    open(agent)
    const actor = actorFor(agent)
    actor.requestRuntimePreemption(
      {
        id: toConversationInputId('runtime-1'),
        historyNodeId: 'runtime-1',
        provenance: ConversationInputProvenance.Runtime,
        responder: ConversationResponderKind.Headless
      },
      toAgentRuntimeSegmentId('runtime-segment-1')
    )
    const preempting = actor.inspect()
    if (preempting.phase !== ConversationPhase.Running || preempting.runMode !== ConversationRunMode.Preempting) {
      throw new Error('runtime preemption did not reach the commit boundary')
    }

    effectSchedulingPaused = true
    actor.failRuntimeTurnCommit(preempting.suspendEffectId)

    expect(ports.execution.discardRuntimeBuffer).toHaveBeenCalledOnce()
    expect(ports.execution.resumeSuspended).not.toHaveBeenCalled()
    expect(actor.inFlightOperations()).toEqual([])

    effectSchedulingPaused = false
    actor.kickDeferredEffects()
    actor.kickDeferredEffects()
    expect(ports.execution.resumeSuspended).toHaveBeenCalledOnce()
  })

  it('drops a deferred foreground resume when Stop supersedes its exact run identity', () => {
    vi.mocked(ports.execution.suspend).mockReturnValue(true)
    open(agent)
    const actor = actorFor(agent)
    actor.requestRuntimePreemption(
      {
        id: toConversationInputId('runtime-1'),
        historyNodeId: 'runtime-1',
        provenance: ConversationInputProvenance.Runtime,
        responder: ConversationResponderKind.Headless
      },
      toAgentRuntimeSegmentId('runtime-segment-1')
    )
    const preempting = actor.inspect()
    if (preempting.phase !== ConversationPhase.Running || preempting.runMode !== ConversationRunMode.Preempting) {
      throw new Error('runtime preemption did not reach the commit boundary')
    }

    effectSchedulingPaused = true
    actor.failRuntimeTurnCommit(preempting.suspendEffectId)
    actor.stop('backup-cancelled-run')
    effectSchedulingPaused = false
    actor.kickDeferredEffects()

    expect(ports.execution.resumeSuspended).not.toHaveBeenCalled()
  })
})
