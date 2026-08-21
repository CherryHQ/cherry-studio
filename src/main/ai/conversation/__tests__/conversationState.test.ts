import {
  ConversationActivityKind,
  ConversationExecutionPhase,
  ConversationInteractionKind,
  ConversationInteractionResumeMode,
  ConversationKind,
  ConversationOutcomeKind,
  ConversationPhase,
  type ConversationRef,
  ConversationTerminalDurability,
  ConversationTurnKind,
  toConversationActivityId,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationInputId,
  toConversationInteractionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import { describe, expect, it } from 'vitest'

import {
  ConversationCommandType,
  ConversationEffectType,
  ConversationExecutionDriverKind,
  ConversationInputProvenance,
  ConversationResponderKind,
  ConversationTerminalAudience,
  createConversationState,
  isConversationQuiescent,
  transitionConversation
} from '..'

const chat = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const agent = { kind: ConversationKind.Agent, id: 'session-1' } as const
const turn = toConversationTurnId('turn-1')
const execution = toConversationExecutionId('execution-1')
const effect = (id: string) => toConversationEffectId(id)
const input = (id: string, responder = ConversationResponderKind.Interactive) => ({
  id: toConversationInputId(id),
  historyNodeId: id,
  provenance: ConversationInputProvenance.Renderer,
  responder
})

function open(ref: ConversationRef = chat) {
  return transitionConversation(createConversationState(ref), {
    type: ConversationCommandType.TurnCommitted,
    inputId: toConversationInputId('user-1'),
    turnId: turn,
    turnKind: ConversationTurnKind.Submit,
    anchorNodeId: 'user-1',
    responder: ConversationResponderKind.Interactive,
    executions: [
      {
        id: execution,
        outputNodeId: 'assistant-1',
        driver:
          ref.kind === ConversationKind.Chat
            ? ConversationExecutionDriverKind.Chat
            : ConversationExecutionDriverKind.Agent,
        modelId: 'provider::model',
        startEffectId: effect('run-1')
      }
    ]
  })
}

function persistSuccess(state: ReturnType<typeof open>['state']) {
  const terminal = transitionConversation(state, {
    type: ConversationCommandType.ExecutionTerminal,
    turnId: turn,
    executionId: execution,
    runEffectId: effect('run-1'),
    outcome: { kind: ConversationOutcomeKind.Success },
    persistenceEffectId: effect('persist-1')
  })
  return transitionConversation(terminal.state, {
    type: ConversationCommandType.PersistenceSucceeded,
    turnId: turn,
    executionId: execution,
    persistenceEffectId: effect('persist-1'),
    statusEffectId: effect('status-1'),
    executionTerminalEffectId: effect('execution-terminal-1'),
    turnTerminalEffectId: effect('turn-terminal-1'),
    quiescenceEffectId: effect('quiescence-1'),
    scheduleEffectId: effect('schedule-1'),
    scheduleStepEffectId: effect('schedule-step-1')
  })
}

describe('Conversation state', () => {
  it('opens a durable turn directly as Running with Starting executions', () => {
    const result = open()

    expect(Object.values(ConversationPhase)).toEqual([
      ConversationPhase.Idle,
      ConversationPhase.Running,
      ConversationPhase.Stopping
    ])
    expect(result.state.phase).toBe(ConversationPhase.Running)
    if (result.state.phase !== ConversationPhase.Running) throw new Error('turn did not open')
    expect(result.state.turn.executions.get(execution)?.phase).toBe(ConversationExecutionPhase.Starting)
    expect(result.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.StartExecution, executionId: execution })
    ])
  })

  it('queues live Chat inputs in durable FIFO order and requests yield', () => {
    let state = open().state
    for (const id of ['user-2', 'user-3']) {
      state = transitionConversation(state, {
        type: ConversationCommandType.InputCommitted,
        input: input(id),
        yieldEffectId: effect(`yield-${id}`)
      }).state
    }

    expect(state.inbox.nextTurn.map(({ id }) => id)).toEqual([
      toConversationInputId('user-2'),
      toConversationInputId('user-3')
    ])
  })

  it('retains the next-turn input until its exact successor commit consumes it', () => {
    const queued = transitionConversation(open().state, {
      type: ConversationCommandType.InputCommitted,
      input: input('user-2'),
      yieldEffectId: effect('yield-1')
    })
    const settled = persistSuccess(queued.state)

    expect(settled.state.phase).toBe(ConversationPhase.Idle)
    expect(settled.state.inbox.nextTurn).toEqual([input('user-2')])
    expect(settled.effects).toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn, input: input('user-2') })
    )

    const successor = transitionConversation(settled.state, {
      type: ConversationCommandType.TurnCommitted,
      inputId: toConversationInputId('user-2'),
      turnId: toConversationTurnId('turn-2'),
      turnKind: ConversationTurnKind.Submit,
      anchorNodeId: 'user-2',
      responder: ConversationResponderKind.Interactive,
      executions: [
        {
          id: toConversationExecutionId('execution-2'),
          outputNodeId: 'assistant-2',
          driver: ConversationExecutionDriverKind.Chat,
          modelId: 'provider::model',
          startEffectId: effect('run-2')
        }
      ]
    })
    expect(successor.rejection).toBeUndefined()
    expect(successor.state.inbox.nextTurn).toEqual([])
  })

  it('keeps an accepted Agent redirect as NextStep until its predecessor is durable', () => {
    let state = open(agent).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: input('user-2'),
      runtimeCanRedirect: true,
      redirectEffectId: effect('redirect-1')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.RedirectAccepted,
      turnId: turn,
      inputId: toConversationInputId('user-2')
    }).state

    const durable = persistSuccess(state)
    expect(durable.state.phase).toBe(ConversationPhase.Running)
    expect(durable.effects.map(({ type }) => type)).toEqual([
      ConversationEffectType.PublishExecutionTerminal,
      ConversationEffectType.ScheduleNextStep
    ])

    const continued = transitionConversation(durable.state, {
      type: ConversationCommandType.StepCommitted,
      turnId: turn,
      inputId: toConversationInputId('user-2'),
      executions: [
        {
          id: toConversationExecutionId('execution-2'),
          outputNodeId: 'assistant-2',
          driver: ConversationExecutionDriverKind.Agent,
          modelId: 'provider::model',
          startEffectId: effect('run-2')
        }
      ]
    })
    expect(continued.state.phase).toBe(ConversationPhase.Running)
    if (continued.state.phase !== ConversationPhase.Running) throw new Error('logical turn settled')
    expect(continued.state.turn.id).toBe(turn)
    expect(continued.state.inbox.nextStep).toEqual([])
  })

  it('treats preparation failure as an execution Error terminal, never a turn preparation state', () => {
    const failed = transitionConversation(open().state, {
      type: ConversationCommandType.ExecutionStartFailed,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      error: { name: 'Error', message: 'context build failed', stack: 'Error: context build failed' },
      persistenceEffectId: effect('persist-error')
    })

    expect(failed.state.phase).toBe(ConversationPhase.Running)
    if (failed.state.phase !== ConversationPhase.Running) throw new Error('turn disappeared')
    expect(failed.state.turn.executions.get(execution)?.phase).toBe(ConversationExecutionPhase.Persisting)
    expect(failed.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.PersistTerminal, executionId: execution })
    ])
  })

  it('persists an interaction checkpoint and starts a new exact run after resolution', () => {
    let state = transitionConversation(open().state, {
      type: ConversationCommandType.InteractionOpened,
      turnId: turn,
      interaction: {
        id: toConversationInteractionId('approval-1'),
        executionId: execution,
        kind: ConversationInteractionKind.ToolApproval,
        resumeMode: ConversationInteractionResumeMode.NewRun
      },
      statusEffectId: effect('interaction-status')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('checkpoint')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.PersistenceSucceeded,
      turnId: turn,
      executionId: execution,
      persistenceEffectId: effect('checkpoint'),
      statusEffectId: effect('waiting-status'),
      executionTerminalEffectId: effect('unused-execution-terminal'),
      turnTerminalEffectId: effect('unused-turn-terminal'),
      quiescenceEffectId: effect('unused-quiescence')
    }).state

    const resumed = transitionConversation(state, {
      type: ConversationCommandType.InteractionResolved,
      turnId: turn,
      interactionId: toConversationInteractionId('approval-1'),
      resumeEffectId: effect('run-2'),
      statusEffectId: effect('resolving-status')
    })
    expect(resumed.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.StartExecution, effectId: effect('run-2') })
    ])
    const registered = transitionConversation(resumed.state, {
      type: ConversationCommandType.InteractionResumeSucceeded,
      turnId: turn,
      interactionId: toConversationInteractionId('approval-1'),
      resumeEffectId: effect('run-2'),
      statusEffectId: effect('running-status')
    })
    expect(registered.state.phase).toBe(ConversationPhase.Running)
    if (registered.state.phase !== ConversationPhase.Running) throw new Error('turn did not resume')
    expect(registered.state.turn.executions.get(execution)?.phase).toBe(ConversationExecutionPhase.Starting)
  })

  it.each([chat, agent])('queues ordinary input for the next turn while an interaction is waiting', (ref) => {
    let waiting = transitionConversation(open(ref).state, {
      type: ConversationCommandType.InteractionOpened,
      turnId: turn,
      interaction: {
        id: toConversationInteractionId('approval-1'),
        executionId: execution,
        kind: ConversationInteractionKind.ToolApproval,
        resumeMode:
          ref.kind === ConversationKind.Chat
            ? ConversationInteractionResumeMode.NewRun
            : ConversationInteractionResumeMode.InPlace
      },
      statusEffectId: effect('interaction-status')
    })
    if (ref.kind === ConversationKind.Chat) {
      const checkpoint = transitionConversation(waiting.state, {
        type: ConversationCommandType.ExecutionTerminal,
        turnId: turn,
        executionId: execution,
        runEffectId: effect('run-1'),
        outcome: { kind: ConversationOutcomeKind.Success },
        persistenceEffectId: effect('checkpoint')
      })
      waiting = transitionConversation(checkpoint.state, {
        type: ConversationCommandType.PersistenceSucceeded,
        turnId: turn,
        executionId: execution,
        persistenceEffectId: effect('checkpoint'),
        statusEffectId: effect('waiting-status'),
        executionTerminalEffectId: effect('unused-execution-terminal'),
        turnTerminalEffectId: effect('unused-turn-terminal'),
        quiescenceEffectId: effect('unused-quiescence')
      })
    }
    const committed = transitionConversation(waiting.state, {
      type: ConversationCommandType.InputCommitted,
      input: input('user-2'),
      runtimeCanRedirect: true,
      yieldEffectId: effect('yield-1'),
      redirectEffectId: effect('redirect-1')
    })

    expect(committed.state.inbox.nextTurn).toEqual([input('user-2')])
    expect(committed.state.inbox.nextStep).toEqual([])
    expect(committed.effects).toEqual([])
  })

  it('Stop clears future input and aborts a Starting resource by exact identity', () => {
    const state = transitionConversation(open(agent).state, {
      type: ConversationCommandType.InputCommitted,
      input: input('user-2'),
      runtimeCanRedirect: true,
      redirectEffectId: effect('redirect-1')
    }).state
    const stopped = transitionConversation(state, {
      type: ConversationCommandType.Stop,
      reason: 'user-stop',
      abortEffectIds: new Map([[execution, effect('abort-1')]]),
      persistenceEffectIds: new Map([[execution, effect('persist-stop')]]),
      turnTerminalEffectId: effect('turn-terminal-stop'),
      quiescenceEffectId: effect('quiescence-stop')
    })

    expect(stopped.state).toMatchObject({
      phase: ConversationPhase.Stopping,
      inbox: { nextTurn: [], nextStep: [] }
    })
    expect(stopped.effects).toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.AbortExecution, executionId: execution })
    )
  })

  it('publishes terminal only after durable persistence and fences stale results', () => {
    const running = open().state
    const stale = transitionConversation(running, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('old-run'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('stale-persist')
    })
    expect(stale.state).toBe(running)

    const durable = persistSuccess(running)
    expect(durable.state.phase).toBe(ConversationPhase.Idle)
    expect(durable.effects).toContainEqual(
      expect.objectContaining({
        type: ConversationEffectType.PublishExecutionTerminal,
        durability: ConversationTerminalDurability.Durable
      })
    )
    expect(isConversationQuiescent(durable.state)).toBe(true)
  })

  it('keeps deferred-recovery terminal delivery inside the application', () => {
    const running = open().state
    const persisting = transitionConversation(running, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Paused, reason: 'stopped' },
      persistenceEffectId: effect('persist')
    }).state
    const abandoned = transitionConversation(persisting, {
      type: ConversationCommandType.PersistenceAbandoned,
      turnId: turn,
      executionId: execution,
      persistenceEffectId: effect('persist'),
      executionTerminalEffectId: effect('execution-terminal'),
      turnTerminalEffectId: effect('turn-terminal'),
      quiescenceEffectId: effect('quiescence')
    })

    expect(abandoned.effects).toContainEqual(
      expect.objectContaining({
        type: ConversationEffectType.PublishExecutionTerminal,
        durability: ConversationTerminalDurability.DeferredRecovery,
        audience: ConversationTerminalAudience.InternalOnly
      })
    )
  })

  it('derives domain quiescence from the aggregate activity owner', () => {
    let state = transitionConversation(createConversationState(agent), {
      type: ConversationCommandType.ActivityOpened,
      activity: { id: toConversationActivityId('compaction'), kind: ConversationActivityKind.Compaction }
    }).state
    expect(isConversationQuiescent(state)).toBe(false)
    state = transitionConversation(state, {
      type: ConversationCommandType.ActivityClosed,
      activityId: toConversationActivityId('compaction'),
      quiescenceEffectId: effect('activity-quiescence')
    }).state
    expect(isConversationQuiescent(state)).toBe(true)
  })
})
