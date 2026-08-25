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

import { toAgentRuntimeRedirectId, toAgentRuntimeSegmentId } from '../../runtime/types'
import {
  ConversationCommandType,
  ConversationEffectType,
  ConversationExecutionDriverKind,
  ConversationInputProvenance,
  ConversationPreemptionPhase,
  ConversationResponderKind,
  ConversationRunMode,
  ConversationRuntimeOwnership,
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
const segmentId = toAgentRuntimeSegmentId('segment-2')
const redirectId = (id: string) => toAgentRuntimeRedirectId(id)
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
    inputIds: [toConversationInputId('user-1')],
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

function deliverRedirect(state: ReturnType<typeof open>['state'], inputId: string) {
  return transitionConversation(state, {
    type: ConversationCommandType.RedirectDelivered,
    turnId: turn,
    redirectIds: [redirectId(inputId)],
    segmentId
  }).state
}

function runtimePreemptedState(responder = ConversationResponderKind.Interactive) {
  const runtimeInput = {
    ...input('runtime-1', responder),
    provenance: ConversationInputProvenance.Runtime
  }
  const suspendEffectId = effect('suspend-runtime')
  let state = transitionConversation(open(agent).state, {
    type: ConversationCommandType.RuntimePreemptionRequested,
    input: runtimeInput,
    suspendEffectId
  }).state
  state = transitionConversation(state, {
    type: ConversationCommandType.RuntimeSuspensionSucceeded,
    suspendEffectId,
    scheduleEffectId: effect('schedule-runtime')
  }).state
  const runtimeTurnId = toConversationTurnId('runtime-turn')
  const runtimeExecutionId = toConversationExecutionId('runtime-execution')
  state = transitionConversation(state, {
    type: ConversationCommandType.RuntimeTurnCommitted,
    inputId: runtimeInput.id,
    suspendEffectId,
    turnId: runtimeTurnId,
    anchorNodeId: null,
    responder,
    executions: [
      {
        id: runtimeExecutionId,
        outputNodeId: 'runtime-assistant',
        driver: ConversationExecutionDriverKind.Agent,
        modelId: 'provider::model',
        startEffectId: effect('runtime-run')
      }
    ]
  }).state
  return { state, runtimeInput, suspendEffectId, runtimeTurnId, runtimeExecutionId }
}

function persistRuntimeTerminal(
  state: ReturnType<typeof runtimePreemptedState>['state'],
  runtimeTurnId: ReturnType<typeof toConversationTurnId>,
  runtimeExecutionId: ReturnType<typeof toConversationExecutionId>,
  outcome:
    | { kind: ConversationOutcomeKind.Success }
    | { kind: ConversationOutcomeKind.Error; error: { name: string; message: string; stack: string | null } }
) {
  const terminal = transitionConversation(state, {
    type: ConversationCommandType.ExecutionTerminal,
    turnId: runtimeTurnId,
    executionId: runtimeExecutionId,
    runEffectId: effect('runtime-run'),
    outcome,
    persistenceEffectId: effect('runtime-persist')
  })
  return transitionConversation(terminal.state, {
    type: ConversationCommandType.PersistenceSucceeded,
    turnId: runtimeTurnId,
    executionId: runtimeExecutionId,
    persistenceEffectId: effect('runtime-persist'),
    statusEffectId: effect('runtime-status'),
    executionTerminalEffectId: effect('runtime-execution-terminal'),
    turnTerminalEffectId: effect('runtime-turn-terminal'),
    quiescenceEffectId: effect('runtime-quiescence'),
    scheduleEffectId: effect('runtime-schedule'),
    scheduleStepEffectId: effect('runtime-step')
  })
}

describe('Conversation state', () => {
  it('creates an active runtime with a session-level pending queue', () => {
    const queued = transitionConversation(open(agent).state, {
      type: ConversationCommandType.InputCommitted,
      input: input('user-2'),
      runtimeCanRedirect: false
    })

    expect(queued.state.phase).toBe(ConversationPhase.Running)
    if (queued.state.phase !== ConversationPhase.Running) throw new Error('Agent turn did not remain active')
    expect(queued.state.turn.id).toBe(turn)
    expect(queued.state.inbox.nextTurn).toEqual([input('user-2')])
  })

  it('marks the runtime idle when the terminal listener observes done', () => {
    const settled = persistSuccess(open(agent).state)

    expect(settled.state.phase).toBe(ConversationPhase.Idle)
    expect(isConversationQuiescent(settled.state)).toBe(true)
  })

  it('ignores per-execution terminal events until the topic is done', () => {
    const sibling = toConversationExecutionId('execution-2')
    let state = transitionConversation(createConversationState(agent), {
      type: ConversationCommandType.TurnCommitted,
      inputId: toConversationInputId('user-1'),
      inputIds: [toConversationInputId('user-1')],
      turnId: turn,
      turnKind: ConversationTurnKind.Submit,
      anchorNodeId: 'user-1',
      responder: ConversationResponderKind.Interactive,
      executions: [
        {
          id: execution,
          outputNodeId: 'assistant-1',
          driver: ConversationExecutionDriverKind.Agent,
          modelId: 'provider::model',
          startEffectId: effect('run-1')
        },
        {
          id: sibling,
          outputNodeId: 'assistant-2',
          driver: ConversationExecutionDriverKind.Agent,
          modelId: 'provider::sibling',
          startEffectId: effect('run-2')
        }
      ]
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('persist-1')
    }).state
    state = transitionConversation(state, {
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
    }).state

    expect(state.phase).toBe(ConversationPhase.Running)
    if (state.phase !== ConversationPhase.Running) throw new Error('Sibling execution did not keep the turn live')
    expect(state.turn.executions.get(execution)?.phase).toBe(ConversationExecutionPhase.Settled)
    expect(state.turn.executions.get(sibling)?.phase).toBe(ConversationExecutionPhase.Starting)
  })

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

  it('replaces one terminal execution in place without reordering its live sibling', () => {
    const sibling = toConversationExecutionId('execution-2')
    const opened = transitionConversation(createConversationState(chat), {
      type: ConversationCommandType.TurnCommitted,
      inputId: toConversationInputId('user-1'),
      inputIds: [toConversationInputId('user-1')],
      turnId: turn,
      turnKind: ConversationTurnKind.Submit,
      anchorNodeId: 'user-1',
      responder: ConversationResponderKind.Interactive,
      executions: [
        {
          id: execution,
          outputNodeId: 'assistant-1',
          driver: ConversationExecutionDriverKind.Chat,
          modelId: 'provider::model',
          startEffectId: effect('run-1')
        },
        {
          id: sibling,
          outputNodeId: 'assistant-2',
          driver: ConversationExecutionDriverKind.Chat,
          modelId: 'provider::model-2',
          startEffectId: effect('run-2')
        }
      ]
    })
    const terminal = transitionConversation(opened.state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Error, error: { name: 'Error', message: 'failed', stack: null } },
      persistenceEffectId: effect('persist-1')
    })
    const settled = transitionConversation(terminal.state, {
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

    const restarted = transitionConversation(settled.state, {
      type: ConversationCommandType.ExecutionRestarted,
      turnId: turn,
      execution: {
        id: execution,
        outputNodeId: 'assistant-1',
        driver: ConversationExecutionDriverKind.Chat,
        modelId: 'provider::model',
        startEffectId: effect('run-retry')
      }
    })

    expect(restarted.rejection).toBeUndefined()
    if (restarted.state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect([...restarted.state.turn.executions.keys()]).toEqual([execution, sibling])
    expect(restarted.state.turn.executions.get(execution)).toMatchObject({
      phase: ConversationExecutionPhase.Starting,
      runEffectId: effect('run-retry')
    })
    expect(restarted.state.turn.executions.get(sibling)?.phase).toBe(ConversationExecutionPhase.Starting)
    expect(restarted.effects).toEqual([
      expect.objectContaining({
        type: ConversationEffectType.StartExecution,
        executionId: execution,
        effectId: effect('run-retry')
      })
    ])
  })

  it('queues a follow-up until an autonomous receive-only turn finishes and persists', () => {
    const runtimeInput = {
      ...input('runtime-1'),
      provenance: ConversationInputProvenance.Runtime
    }
    const requested = transitionConversation(open(agent).state, {
      type: ConversationCommandType.RuntimePreemptionRequested,
      input: runtimeInput,
      suspendEffectId: effect('suspend-1')
    })
    expect(requested.state).toMatchObject({
      phase: ConversationPhase.Running,
      runMode: ConversationRunMode.Preempting,
      preemptionPhase: ConversationPreemptionPhase.Suspending,
      runtimeOwnership: ConversationRuntimeOwnership.Active
    })
    expect(requested.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.SuspendExecution, executionId: execution })
    ])

    const suspended = transitionConversation(requested.state, {
      type: ConversationCommandType.RuntimeSuspensionSucceeded,
      suspendEffectId: effect('suspend-1'),
      scheduleEffectId: effect('schedule-runtime')
    })
    expect(suspended.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.ScheduleRuntimeTurn, input: runtimeInput })
    ])

    const runtimeTurnId = toConversationTurnId('runtime-turn')
    const runtimeExecution = toConversationExecutionId('runtime-execution')
    let state = transitionConversation(suspended.state, {
      type: ConversationCommandType.RuntimeTurnCommitted,
      inputId: runtimeInput.id,
      suspendEffectId: effect('suspend-1'),
      turnId: runtimeTurnId,
      anchorNodeId: null,
      responder: ConversationResponderKind.Interactive,
      executions: [
        {
          id: runtimeExecution,
          outputNodeId: 'runtime-assistant',
          driver: ConversationExecutionDriverKind.Agent,
          modelId: 'provider::model',
          startEffectId: effect('runtime-run')
        }
      ]
    }).state
    expect(state).toMatchObject({
      runMode: ConversationRunMode.RuntimePreempted,
      runtimeOwnership: ConversationRuntimeOwnership.Active,
      runtimeTerminalDurable: false,
      suspendedTurn: { id: turn }
    })

    const staleRelease = transitionConversation(state, {
      type: ConversationCommandType.RuntimeOwnershipReleased,
      suspendEffectId: effect('old-suspend'),
      resumeEffectId: effect('stale-resume'),
      quiescenceEffectId: effect('stale-quiescence')
    })
    expect(staleRelease.rejection).toBeDefined()
    expect(staleRelease.state).toBe(state)

    state = transitionConversation(state, {
      type: ConversationCommandType.RuntimeOwnershipReleased,
      suspendEffectId: effect('suspend-1'),
      resumeEffectId: effect('resume-early'),
      quiescenceEffectId: effect('quiescence-early')
    }).state
    expect(state).toMatchObject({
      runMode: ConversationRunMode.RuntimePreempted,
      runtimeOwnership: ConversationRuntimeOwnership.Released
    })

    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: runtimeTurnId,
      executionId: runtimeExecution,
      runEffectId: effect('runtime-run'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('runtime-persist')
    }).state
    const durable = transitionConversation(state, {
      type: ConversationCommandType.PersistenceSucceeded,
      turnId: runtimeTurnId,
      executionId: runtimeExecution,
      persistenceEffectId: effect('runtime-persist'),
      statusEffectId: effect('runtime-status'),
      executionTerminalEffectId: effect('runtime-execution-terminal'),
      turnTerminalEffectId: effect('runtime-turn-terminal'),
      quiescenceEffectId: effect('runtime-quiescence'),
      scheduleEffectId: effect('resume-foreground'),
      scheduleStepEffectId: effect('runtime-step')
    })
    expect(durable.state).toMatchObject({
      phase: ConversationPhase.Running,
      runMode: ConversationRunMode.Foreground,
      turn: { id: turn }
    })
    expect(durable.effects.map(({ type }) => type)).toEqual([
      ConversationEffectType.PublishExecutionTerminal,
      ConversationEffectType.PublishTurnTerminal,
      ConversationEffectType.ResumeSuspendedExecution
    ])
  })

  it('surfaces an early receive-only error and restores the deferred turn after connection loss', () => {
    const runtime = runtimePreemptedState()
    const durable = persistRuntimeTerminal(runtime.state, runtime.runtimeTurnId, runtime.runtimeExecutionId, {
      kind: ConversationOutcomeKind.Error,
      error: { name: 'Error', message: 'connection lost', stack: null }
    })
    expect(durable.state).toMatchObject({
      phase: ConversationPhase.Running,
      runMode: ConversationRunMode.RuntimePreempted,
      runtimeTerminalDurable: true,
      runtimeOwnership: ConversationRuntimeOwnership.Active
    })

    const released = transitionConversation(durable.state, {
      type: ConversationCommandType.RuntimeOwnershipReleased,
      suspendEffectId: runtime.suspendEffectId,
      resumeEffectId: effect('resume-foreground'),
      quiescenceEffectId: effect('resume-quiescence')
    })

    expect(released.state).toMatchObject({
      phase: ConversationPhase.Running,
      runMode: ConversationRunMode.Foreground,
      turn: { id: turn }
    })
    expect(released.effects).toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.ResumeSuspendedExecution, executionId: execution })
    )
  })

  it('lets a receive-only generation finish before admitting a user turn that was still reconciling', () => {
    const runtime = runtimePreemptedState()
    const followUp = input('user-2')
    let state = transitionConversation(runtime.state, {
      type: ConversationCommandType.InputCommitted,
      input: followUp,
      runtimeCanRedirect: false
    }).state
    expect(state.inbox.nextTurn).toEqual([followUp])

    state = transitionConversation(state, {
      type: ConversationCommandType.RuntimeOwnershipReleased,
      suspendEffectId: runtime.suspendEffectId,
      resumeEffectId: effect('resume-too-early'),
      quiescenceEffectId: effect('quiescence-too-early')
    }).state
    expect(state).toMatchObject({
      runMode: ConversationRunMode.RuntimePreempted,
      runtimeOwnership: ConversationRuntimeOwnership.Released
    })

    const durable = persistRuntimeTerminal(state, runtime.runtimeTurnId, runtime.runtimeExecutionId, {
      kind: ConversationOutcomeKind.Success
    })
    expect(durable.state).toMatchObject({
      phase: ConversationPhase.Running,
      runMode: ConversationRunMode.Foreground,
      inbox: { nextTurn: [followUp] }
    })
    expect(durable.effects).toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.ResumeSuspendedExecution })
    )
    expect(durable.effects).not.toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn })
    )
  })

  it('claims multiple compatible follow-ups as one ordered batch after an autonomous wake', () => {
    const runtime = runtimePreemptedState()
    const first = input('user-2')
    const second = input('user-3')
    let state = transitionConversation(runtime.state, {
      type: ConversationCommandType.InputCommitted,
      input: first,
      runtimeCanRedirect: false
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: second,
      runtimeCanRedirect: false
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.RuntimeOwnershipReleased,
      suspendEffectId: runtime.suspendEffectId,
      resumeEffectId: effect('resume-runtime'),
      quiescenceEffectId: effect('runtime-release-quiescence')
    }).state
    state = persistRuntimeTerminal(state, runtime.runtimeTurnId, runtime.runtimeExecutionId, {
      kind: ConversationOutcomeKind.Success
    }).state

    const foregroundDurable = persistSuccess(state)
    expect(foregroundDurable.state.inbox.nextTurn).toEqual([first, second])
    expect(foregroundDurable.effects).toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn, inputs: [first, second] })
    )

    const nextTurnId = toConversationTurnId('turn-2')
    const nextExecutionId = toConversationExecutionId('execution-2')
    state = transitionConversation(foregroundDurable.state, {
      type: ConversationCommandType.TurnCommitted,
      inputId: first.id,
      inputIds: [first.id, second.id],
      turnId: nextTurnId,
      turnKind: ConversationTurnKind.Submit,
      anchorNodeId: first.historyNodeId,
      responder: first.responder,
      executions: [
        {
          id: nextExecutionId,
          outputNodeId: 'assistant-2',
          driver: ConversationExecutionDriverKind.Agent,
          modelId: 'provider::model',
          startEffectId: effect('run-2')
        }
      ]
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: nextTurnId,
      executionId: nextExecutionId,
      runEffectId: effect('run-2'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('persist-2')
    }).state
    const settled = transitionConversation(state, {
      type: ConversationCommandType.PersistenceSucceeded,
      turnId: nextTurnId,
      executionId: nextExecutionId,
      persistenceEffectId: effect('persist-2'),
      statusEffectId: effect('status-2'),
      executionTerminalEffectId: effect('execution-terminal-2'),
      turnTerminalEffectId: effect('turn-terminal-2'),
      quiescenceEffectId: effect('quiescence-2'),
      scheduleEffectId: effect('schedule-2'),
      scheduleStepEffectId: effect('schedule-step-2')
    })

    expect(settled.state.inbox.nextTurn).toEqual([])
    expect(settled.effects).not.toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn })
    )
  })

  it('restores a deferred turn once when the receive-only placeholder cannot be saved', () => {
    const runtimeInput = { ...input('runtime-1'), provenance: ConversationInputProvenance.Runtime }
    let state = transitionConversation(open(agent).state, {
      type: ConversationCommandType.RuntimePreemptionRequested,
      input: runtimeInput,
      suspendEffectId: effect('suspend-1')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.RuntimeSuspensionSucceeded,
      suspendEffectId: effect('suspend-1'),
      scheduleEffectId: effect('schedule-runtime')
    }).state
    const failed = transitionConversation(state, {
      type: ConversationCommandType.RuntimeTurnCommitFailed,
      suspendEffectId: effect('suspend-1'),
      resumeEffectId: effect('resume-1'),
      discardEffectId: effect('discard-1')
    })

    expect(failed.state).toMatchObject({
      phase: ConversationPhase.Running,
      runMode: ConversationRunMode.Foreground,
      turn: { id: turn }
    })
    expect(failed.effects.map(({ type }) => type)).toEqual([
      ConversationEffectType.ResumeSuspendedExecution,
      ConversationEffectType.DiscardRuntimeBuffer
    ])
  })

  it('stops runtime and suspended foreground exactly once and waits for ownership release', () => {
    const runtimeInput = { ...input('runtime-stop'), provenance: ConversationInputProvenance.Runtime }
    let state = transitionConversation(open(agent).state, {
      type: ConversationCommandType.RuntimePreemptionRequested,
      input: runtimeInput,
      suspendEffectId: effect('suspend-stop')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.RuntimeSuspensionSucceeded,
      suspendEffectId: effect('suspend-stop'),
      scheduleEffectId: effect('schedule-stop')
    }).state
    const runtimeTurnId = toConversationTurnId('runtime-stop-turn')
    const runtimeExecution = toConversationExecutionId('runtime-stop-execution')
    state = transitionConversation(state, {
      type: ConversationCommandType.RuntimeTurnCommitted,
      inputId: runtimeInput.id,
      suspendEffectId: effect('suspend-stop'),
      turnId: runtimeTurnId,
      anchorNodeId: null,
      responder: ConversationResponderKind.Interactive,
      executions: [
        {
          id: runtimeExecution,
          outputNodeId: 'runtime-stop-assistant',
          driver: ConversationExecutionDriverKind.Agent,
          modelId: 'provider::model',
          startEffectId: effect('runtime-stop-run')
        }
      ]
    }).state
    const stopped = transitionConversation(state, {
      type: ConversationCommandType.Stop,
      reason: 'user-stop',
      abortEffectIds: new Map([
        [execution, effect('abort-foreground')],
        [runtimeExecution, effect('abort-runtime')]
      ]),
      persistenceEffectIds: new Map([
        [execution, effect('persist-foreground')],
        [runtimeExecution, effect('persist-runtime')]
      ]),
      turnTerminalEffectId: effect('stop-turn-terminal'),
      quiescenceEffectId: effect('stop-quiescence'),
      discardEffectId: effect('stop-discard'),
      dropEffectId: effect('stop-drop-inputs')
    })
    expect(stopped.state).toMatchObject({
      phase: ConversationPhase.Stopping,
      runMode: ConversationRunMode.RuntimePreempted,
      runtimeOwnership: ConversationRuntimeOwnership.Active
    })
    expect(stopped.effects.map(({ type }) => type)).toEqual([
      ConversationEffectType.AbortExecution,
      ConversationEffectType.AbortExecution,
      ConversationEffectType.PersistTerminal,
      ConversationEffectType.DiscardRuntimeBuffer
    ])
    expect(stopped.effects).toContainEqual(
      expect.objectContaining({
        type: ConversationEffectType.DiscardRuntimeBuffer,
        preemptionId: effect('suspend-stop')
      })
    )

    state = transitionConversation(stopped.state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: runtimeTurnId,
      executionId: runtimeExecution,
      runEffectId: effect('runtime-stop-run'),
      outcome: { kind: ConversationOutcomeKind.Paused, reason: 'user-stop' },
      persistenceEffectId: effect('persist-runtime')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.PersistenceSucceeded,
      turnId: runtimeTurnId,
      executionId: runtimeExecution,
      persistenceEffectId: effect('persist-runtime'),
      statusEffectId: effect('status-runtime'),
      executionTerminalEffectId: effect('terminal-runtime'),
      turnTerminalEffectId: effect('turn-terminal-runtime'),
      quiescenceEffectId: effect('quiescence-runtime')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.PersistenceSucceeded,
      turnId: turn,
      executionId: execution,
      persistenceEffectId: effect('persist-foreground'),
      statusEffectId: effect('status-foreground'),
      executionTerminalEffectId: effect('terminal-foreground'),
      turnTerminalEffectId: effect('turn-terminal-foreground'),
      quiescenceEffectId: effect('quiescence-foreground')
    }).state
    expect(state.phase).toBe(ConversationPhase.Stopping)

    const released = transitionConversation(state, {
      type: ConversationCommandType.RuntimeOwnershipReleased,
      suspendEffectId: effect('suspend-stop'),
      resumeEffectId: effect('resume-unused'),
      quiescenceEffectId: effect('quiescence-release')
    })
    expect(released.state.phase).toBe(ConversationPhase.Idle)
    expect(released.effects).toEqual([expect.objectContaining({ type: ConversationEffectType.PublishQuiescence })])
  })

  it('discards the exact autonomous resource when Stop interrupts Preempting', () => {
    const preemptionId = effect('suspend-preempting')
    const runtimeInput = { ...input('runtime-preempting'), provenance: ConversationInputProvenance.Runtime }
    const preempting = transitionConversation(open(agent).state, {
      type: ConversationCommandType.RuntimePreemptionRequested,
      input: runtimeInput,
      suspendEffectId: preemptionId
    }).state

    const stopped = transitionConversation(preempting, {
      type: ConversationCommandType.Stop,
      reason: 'user-stop',
      abortEffectIds: new Map([[execution, effect('abort-preempting')]]),
      persistenceEffectIds: new Map([[execution, effect('persist-preempting')]]),
      turnTerminalEffectId: effect('terminal-preempting'),
      quiescenceEffectId: effect('quiescence-preempting'),
      discardEffectId: effect('discard-preempting'),
      dropEffectId: effect('drop-preempting-inputs')
    })

    expect(stopped.state.phase).toBe(ConversationPhase.Stopping)
    expect(stopped.effects).toContainEqual(
      expect.objectContaining({
        type: ConversationEffectType.DiscardRuntimeBuffer,
        effectId: effect('discard-preempting'),
        preemptionId
      })
    )
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
      expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn, inputs: [input('user-2')] })
    )

    const successor = transitionConversation(settled.state, {
      type: ConversationCommandType.TurnCommitted,
      inputId: toConversationInputId('user-2'),
      inputIds: [toConversationInputId('user-2')],
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

  it('claims the contiguous same-profile prefix as one successor turn', () => {
    const first = { ...input('user-2'), batchKey: 'profile-a' }
    const second = { ...input('user-3'), batchKey: 'profile-a' }
    const third = { ...input('user-4'), batchKey: 'profile-b' }
    let state = open().state
    for (const queued of [first, second, third]) {
      state = transitionConversation(state, {
        type: ConversationCommandType.InputCommitted,
        input: queued,
        runtimeCanRedirect: false
      }).state
    }

    const settled = persistSuccess(state)
    expect(settled.effects).toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn, inputs: [first, second] })
    )
    const successor = transitionConversation(settled.state, {
      type: ConversationCommandType.TurnCommitted,
      inputId: first.id,
      inputIds: [first.id, second.id],
      turnId: toConversationTurnId('turn-batch'),
      turnKind: ConversationTurnKind.Submit,
      anchorNodeId: first.historyNodeId,
      responder: ConversationResponderKind.Interactive,
      executions: [
        {
          id: toConversationExecutionId('execution-batch'),
          outputNodeId: 'assistant-batch',
          driver: ConversationExecutionDriverKind.Chat,
          modelId: 'provider::model',
          startEffectId: effect('run-batch')
        }
      ]
    })

    expect(successor.rejection).toBeUndefined()
    expect(successor.state.inbox.nextTurn).toEqual([third])
  })

  it('keeps a follow-up queued while the completed turn is awaiting persistence', () => {
    const queued = transitionConversation(open(agent).state, {
      type: ConversationCommandType.InputCommitted,
      input: input('user-2'),
      runtimeCanRedirect: false,
      yieldEffectId: effect('unused-yield')
    })
    const terminal = transitionConversation(queued.state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('persist-1')
    })

    expect(terminal.state.phase).toBe(ConversationPhase.Running)
    expect(terminal.state.inbox.nextTurn).toEqual([input('user-2')])
    expect(terminal.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.PersistTerminal, effectId: effect('persist-1') })
    ])
    expect(terminal.effects).not.toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn })
    )
  })

  it('waits for stream persistence before scheduling a queued turn after runtime completion', () => {
    let state = transitionConversation(open(agent).state, {
      type: ConversationCommandType.InputCommitted,
      input: input('user-2'),
      runtimeCanRedirect: false,
      yieldEffectId: effect('unused-yield')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('persist-1')
    }).state
    const durable = transitionConversation(state, {
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

    expect(durable.state.phase).toBe(ConversationPhase.Idle)
    expect(durable.state.inbox.nextTurn).toEqual([input('user-2')])
    expect(durable.effects).toContainEqual(
      expect.objectContaining({
        type: ConversationEffectType.ScheduleNextTurn,
        inputs: [input('user-2')],
        effectId: effect('schedule-1')
      })
    )
  })

  it('does not consume a queued turn when startNextTurn runs before runtime ownership is idle', () => {
    let state = transitionConversation(open(agent).state, {
      type: ConversationCommandType.InputCommitted,
      input: input('user-2'),
      runtimeCanRedirect: false
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('persist-1')
    }).state

    const kicked = transitionConversation(state, {
      type: ConversationCommandType.KickInbox,
      scheduleEffectId: effect('premature-schedule')
    })

    expect(kicked.state).toBe(state)
    expect(kicked.state.inbox.nextTurn).toEqual([input('user-2')])
    expect(kicked.effects).toEqual([])
  })

  it('drops only the failed successor and schedules the next committed input', () => {
    const first = input('user-2')
    const second = input('user-3')
    let state = transitionConversation(open().state, {
      type: ConversationCommandType.InputCommitted,
      input: first,
      yieldEffectId: effect('yield-1')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: second,
      yieldEffectId: effect('yield-2')
    }).state
    const settled = persistSuccess(state)

    const dropped = transitionConversation(settled.state, {
      type: ConversationCommandType.InputDropped,
      turnId: turn,
      inputId: first.id,
      dropEffectId: effect('drop-1'),
      scheduleEffectId: effect('schedule-2'),
      quiescenceEffectId: effect('quiescence-2')
    })

    expect(dropped.rejection).toBeUndefined()
    expect(dropped.state.inbox.nextTurn).toEqual([second])
    expect(dropped.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.DropInputs, inputs: [first] }),
      expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn, inputs: [second] })
    ])
  })

  it('keeps an accepted Agent redirect as NextStep until its predecessor is durable', () => {
    let state = open(agent).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: input('user-2'),
      runtimeCanRedirect: true,
      redirectEffectId: effect('redirect-1')
    }).state
    state = deliverRedirect(state, 'user-2')

    const durable = persistSuccess(state)
    expect(durable.state.phase).toBe(ConversationPhase.Running)
    expect(durable.effects.map(({ type }) => type)).toEqual([
      ConversationEffectType.ScheduleNextStep,
      ConversationEffectType.PublishExecutionTerminal
    ])

    const continued = transitionConversation(durable.state, {
      type: ConversationCommandType.StepCommitted,
      turnId: turn,
      inputIds: [toConversationInputId('user-2')],
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

  it('admits a steer-flagged turn with a system-reminder and consumes the flag (invariant 7)', () => {
    let state = open(agent).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: input('steer-input'),
      runtimeCanRedirect: true,
      redirectEffectId: effect('redirect-steer')
    }).state
    state = deliverRedirect(state, 'steer-input')
    state = persistSuccess(state).state

    const committed = transitionConversation(state, {
      type: ConversationCommandType.StepCommitted,
      turnId: turn,
      inputIds: [toConversationInputId('steer-input')],
      executions: [
        {
          id: toConversationExecutionId('steer-execution'),
          outputNodeId: 'assistant-steer',
          driver: ConversationExecutionDriverKind.Agent,
          modelId: 'provider::model',
          startEffectId: effect('run-steer')
        }
      ]
    })

    expect(committed.rejection).toBeUndefined()
    expect(committed.state.inbox.nextStep).toEqual([])
    expect(committed.effects).toEqual([
      expect.objectContaining({
        type: ConversationEffectType.StartExecution,
        executionId: toConversationExecutionId('steer-execution')
      })
    ])
  })

  it('re-kicks a retained Agent step after a write-quiesce barrier releases', () => {
    let state = open(agent).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: input('step-input'),
      runtimeCanRedirect: true,
      redirectEffectId: effect('redirect-step')
    }).state
    state = deliverRedirect(state, 'step-input')
    state = persistSuccess(state).state

    const kicked = transitionConversation(state, {
      type: ConversationCommandType.KickInbox,
      scheduleEffectId: effect('kick-step')
    })

    expect(kicked.effects).toEqual([
      expect.objectContaining({
        type: ConversationEffectType.ScheduleNextStep,
        turnId: turn,
        inputs: [expect.objectContaining({ id: toConversationInputId('step-input') })]
      })
    ])
  })

  it('schedules the retained NextTurn input when a committed Agent step fails', () => {
    let state = open(agent).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: input('step-input'),
      runtimeCanRedirect: true,
      redirectEffectId: effect('redirect-step')
    }).state
    state = deliverRedirect(state, 'step-input')
    state = persistSuccess(state).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: input('next-turn-input')
    }).state

    const failed = transitionConversation(state, {
      type: ConversationCommandType.StepFailed,
      turnId: turn,
      inputIds: [toConversationInputId('step-input')],
      error: { name: 'Error', message: 'step commit failed', stack: null },
      turnTerminalEffectId: effect('step-terminal'),
      quiescenceEffectId: effect('step-quiescence'),
      scheduleEffectId: effect('schedule-next-turn')
    })

    expect(failed.state.phase).toBe(ConversationPhase.Idle)
    expect(failed.state.inbox.nextTurn).toEqual([input('next-turn-input')])
    expect(failed.effects).toContainEqual(
      expect.objectContaining({
        type: ConversationEffectType.ScheduleNextTurn,
        effectId: effect('schedule-next-turn'),
        inputs: [input('next-turn-input')]
      })
    )
  })

  it('abandons the roll and surfaces the error when the continuation placeholder save rejects (S5)', () => {
    let state = open(agent).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: input('step-input'),
      runtimeCanRedirect: true,
      redirectEffectId: effect('redirect-step')
    }).state
    state = deliverRedirect(state, 'step-input')
    state = persistSuccess(state).state

    const failed = transitionConversation(state, {
      type: ConversationCommandType.StepFailed,
      turnId: turn,
      inputIds: [toConversationInputId('step-input')],
      error: { name: 'Error', message: 'assistant skeleton transaction failed', stack: null },
      turnTerminalEffectId: effect('step-terminal'),
      quiescenceEffectId: effect('step-quiescence'),
      scheduleEffectId: effect('step-schedule')
    })

    expect(failed.state.phase).toBe(ConversationPhase.Idle)
    expect(failed.state.inbox.nextStep).toEqual([])
    expect(failed.effects).toContainEqual(
      expect.objectContaining({
        type: ConversationEffectType.PublishTurnTerminal,
        outcome: expect.objectContaining({ kind: ConversationOutcomeKind.Error })
      })
    )
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

  it('records awaiting-approval when an execution completes paused on a tool-approval-request', () => {
    let state = transitionConversation(open().state, {
      type: ConversationCommandType.ExecutionFirstChunk,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      statusEffectId: effect('streaming-status')
    }).state
    const observed = transitionConversation(state, {
      type: ConversationCommandType.InteractionOpened,
      turnId: turn,
      interaction: {
        id: toConversationInteractionId('approval-1'),
        executionId: execution,
        kind: ConversationInteractionKind.ToolApproval,
        resumeMode: ConversationInteractionResumeMode.NewRun
      },
      statusEffectId: effect('observed-status')
    })
    state = observed.state

    expect(observed.effects).toEqual([])
    expect(state.phase).toBe(ConversationPhase.Running)
    if (state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect(state.turn.executions.get(execution)?.phase).toBe(ConversationExecutionPhase.Active)

    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('approval-checkpoint')
    }).state
    const durable = transitionConversation(state, {
      type: ConversationCommandType.PersistenceSucceeded,
      turnId: turn,
      executionId: execution,
      persistenceEffectId: effect('approval-checkpoint'),
      statusEffectId: effect('awaiting-status'),
      executionTerminalEffectId: effect('unused-execution-terminal'),
      turnTerminalEffectId: effect('unused-turn-terminal'),
      quiescenceEffectId: effect('unused-quiescence')
    })

    expect(durable.state.phase).toBe(ConversationPhase.Running)
    if (durable.state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect(durable.state.turn.executions.get(execution)).toMatchObject({
      phase: ConversationExecutionPhase.WaitingInteraction,
      interactionIds: [toConversationInteractionId('approval-1')]
    })
    expect(durable.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.PublishStatus, effectId: effect('awaiting-status') })
    ])
  })

  it('closes the exact live interaction when its execution reports completion', () => {
    const active = transitionConversation(open().state, {
      type: ConversationCommandType.ExecutionFirstChunk,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      statusEffectId: effect('streaming-status')
    })
    const interactionId = toConversationInteractionId('approval-1')
    const observed = transitionConversation(active.state, {
      type: ConversationCommandType.InteractionOpened,
      turnId: turn,
      interaction: {
        id: interactionId,
        executionId: execution,
        kind: ConversationInteractionKind.ToolApproval,
        resumeMode: ConversationInteractionResumeMode.NewRun
      },
      statusEffectId: effect('approval-status')
    })
    const completed = transitionConversation(observed.state, {
      type: ConversationCommandType.InteractionCompleted,
      turnId: turn,
      executionId: execution,
      interactionId,
      runEffectId: effect('run-1'),
      statusEffectId: effect('completed-status')
    })

    expect(completed.rejection).toBeUndefined()
    if (completed.state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect(completed.state.turn.interactions.size).toBe(0)
    expect(completed.state.turn.executions.get(execution)?.phase).toBe(ConversationExecutionPhase.Active)
    expect(completed.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.PublishStatus, effectId: effect('completed-status') })
    ])
  })

  it('advances an approved live tool part so the next parallel approval can surface', () => {
    let state = transitionConversation(open(agent).state, {
      type: ConversationCommandType.ExecutionFirstChunk,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      statusEffectId: effect('streaming-status')
    }).state
    for (const approvalId of ['approval-1', 'approval-2']) {
      state = transitionConversation(state, {
        type: ConversationCommandType.InteractionOpened,
        turnId: turn,
        interaction: {
          id: toConversationInteractionId(approvalId),
          executionId: execution,
          kind: ConversationInteractionKind.ToolApproval,
          resumeMode: ConversationInteractionResumeMode.InPlace
        },
        statusEffectId: effect(`${approvalId}-status`)
      }).state
    }

    const firstResolution = transitionConversation(state, {
      type: ConversationCommandType.InteractionResolved,
      turnId: turn,
      interactionId: toConversationInteractionId('approval-1'),
      resumeEffectId: effect('resume-1'),
      statusEffectId: effect('resolving-1-status')
    })
    expect(firstResolution.effects).toEqual([
      expect.objectContaining({
        type: ConversationEffectType.ResumeExecution,
        interactionId: toConversationInteractionId('approval-1'),
        effectId: effect('resume-1')
      })
    ])

    const firstResumed = transitionConversation(firstResolution.state, {
      type: ConversationCommandType.InteractionResumeSucceeded,
      turnId: turn,
      interactionId: toConversationInteractionId('approval-1'),
      resumeEffectId: effect('resume-1'),
      statusEffectId: effect('approval-2-status')
    })
    expect(firstResumed.state.phase).toBe(ConversationPhase.Running)
    if (firstResumed.state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect(firstResumed.state.turn.interactions.has(toConversationInteractionId('approval-1'))).toBe(false)
    expect(firstResumed.state.turn.interactions.has(toConversationInteractionId('approval-2'))).toBe(true)
    expect(firstResumed.state.turn.executions.get(execution)).toMatchObject({
      phase: ConversationExecutionPhase.WaitingInteraction,
      interactionIds: [toConversationInteractionId('approval-2')]
    })

    const secondResolution = transitionConversation(firstResumed.state, {
      type: ConversationCommandType.InteractionResolved,
      turnId: turn,
      interactionId: toConversationInteractionId('approval-2'),
      resumeEffectId: effect('resume-2'),
      statusEffectId: effect('resolving-2-status')
    })
    const secondResumed = transitionConversation(secondResolution.state, {
      type: ConversationCommandType.InteractionResumeSucceeded,
      turnId: turn,
      interactionId: toConversationInteractionId('approval-2'),
      resumeEffectId: effect('resume-2'),
      statusEffectId: effect('active-status')
    })
    expect(secondResumed.state.phase).toBe(ConversationPhase.Running)
    if (secondResumed.state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect(secondResumed.state.turn.interactions.size).toBe(0)
    expect(secondResumed.state.turn.executions.get(execution)?.phase).toBe(ConversationExecutionPhase.Active)
  })

  it('keeps awaiting-approval when a sibling tool resolves while another approval is still pending', () => {
    let state = open().state
    for (const approvalId of ['approval-1', 'approval-2']) {
      state = transitionConversation(state, {
        type: ConversationCommandType.InteractionOpened,
        turnId: turn,
        interaction: {
          id: toConversationInteractionId(approvalId),
          executionId: execution,
          kind: ConversationInteractionKind.ToolApproval,
          resumeMode: ConversationInteractionResumeMode.NewRun
        },
        statusEffectId: effect(`${approvalId}-observed`)
      }).state
    }
    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('approval-checkpoint')
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.PersistenceSucceeded,
      turnId: turn,
      executionId: execution,
      persistenceEffectId: effect('approval-checkpoint'),
      statusEffectId: effect('awaiting-status'),
      executionTerminalEffectId: effect('unused-execution-terminal'),
      turnTerminalEffectId: effect('unused-turn-terminal'),
      quiescenceEffectId: effect('unused-quiescence')
    }).state

    const firstDecision = transitionConversation(state, {
      type: ConversationCommandType.InteractionResolved,
      turnId: turn,
      interactionId: toConversationInteractionId('approval-1'),
      resumeEffectId: effect('unused-resume-1'),
      statusEffectId: effect('approval-2-status')
    })
    expect(firstDecision.state.phase).toBe(ConversationPhase.Running)
    if (firstDecision.state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect(firstDecision.state.turn.executions.get(execution)).toMatchObject({
      phase: ConversationExecutionPhase.WaitingInteraction,
      interactionIds: [toConversationInteractionId('approval-2')]
    })
    expect(firstDecision.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.PublishStatus, effectId: effect('approval-2-status') })
    ])

    const finalDecision = transitionConversation(firstDecision.state, {
      type: ConversationCommandType.InteractionResolved,
      turnId: turn,
      interactionId: toConversationInteractionId('approval-2'),
      resumeEffectId: effect('resume-new-run'),
      statusEffectId: effect('resolving-status')
    })
    expect(finalDecision.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.StartExecution, effectId: effect('resume-new-run') })
    ])
  })

  it('onExecutionPaused while awaiting approval clears the flag → status aborted, anchor dropped, no minted chunk', () => {
    const awaiting = transitionConversation(open().state, {
      type: ConversationCommandType.InteractionOpened,
      turnId: turn,
      interaction: {
        id: toConversationInteractionId('approval-1'),
        executionId: execution,
        kind: ConversationInteractionKind.ToolApproval,
        resumeMode: ConversationInteractionResumeMode.NewRun
      },
      statusEffectId: effect('observed-status')
    }).state
    const terminal = transitionConversation(awaiting, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Paused, reason: 'stopped' },
      persistenceEffectId: effect('persist-paused')
    })

    expect(terminal.state.phase).toBe(ConversationPhase.Running)
    if (terminal.state.phase !== ConversationPhase.Running) throw new Error('turn disappeared before persistence')
    expect(terminal.state.turn.interactions.size).toBe(0)
    expect(terminal.state.turn.executions.get(execution)).toMatchObject({
      phase: ConversationExecutionPhase.Persisting,
      outcome: { kind: ConversationOutcomeKind.Paused }
    })
    expect(terminal.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.PersistTerminal, effectId: effect('persist-paused') })
    ])
  })

  it('onExecutionError while awaiting approval clears the flag → status error, anchor dropped', () => {
    const awaiting = transitionConversation(open().state, {
      type: ConversationCommandType.InteractionOpened,
      turnId: turn,
      interaction: {
        id: toConversationInteractionId('approval-1'),
        executionId: execution,
        kind: ConversationInteractionKind.ToolApproval,
        resumeMode: ConversationInteractionResumeMode.NewRun
      },
      statusEffectId: effect('observed-status')
    }).state
    const terminal = transitionConversation(awaiting, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Error, error: { name: 'Error', message: 'boom', stack: null } },
      persistenceEffectId: effect('persist-error')
    })

    expect(terminal.state.phase).toBe(ConversationPhase.Running)
    if (terminal.state.phase !== ConversationPhase.Running) throw new Error('turn disappeared before persistence')
    expect(terminal.state.turn.interactions.size).toBe(0)
    expect(terminal.state.turn.executions.get(execution)).toMatchObject({
      phase: ConversationExecutionPhase.Persisting,
      outcome: { kind: ConversationOutcomeKind.Error }
    })
  })

  it('multi-model: flips on first chunk from any execution and stays pending if an execution errors before any chunks', () => {
    const secondExecution = toConversationExecutionId('execution-2')
    let state = transitionConversation(createConversationState(chat), {
      type: ConversationCommandType.TurnCommitted,
      inputId: toConversationInputId('user-1'),
      inputIds: [toConversationInputId('user-1')],
      turnId: turn,
      turnKind: ConversationTurnKind.Submit,
      anchorNodeId: 'user-1',
      responder: ConversationResponderKind.Interactive,
      executions: [
        {
          id: execution,
          outputNodeId: 'assistant-1',
          driver: ConversationExecutionDriverKind.Chat,
          modelId: 'provider::model-a',
          startEffectId: effect('run-1')
        },
        {
          id: secondExecution,
          outputNodeId: 'assistant-2',
          driver: ConversationExecutionDriverKind.Chat,
          modelId: 'provider::model-b',
          startEffectId: effect('run-2')
        }
      ]
    }).state
    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Error, error: { name: 'Error', message: 'early', stack: null } },
      persistenceEffectId: effect('persist-error')
    }).state
    const firstSettled = transitionConversation(state, {
      type: ConversationCommandType.PersistenceSucceeded,
      turnId: turn,
      executionId: execution,
      persistenceEffectId: effect('persist-error'),
      statusEffectId: effect('pending-status'),
      executionTerminalEffectId: effect('execution-terminal-1'),
      turnTerminalEffectId: effect('unused-turn-terminal'),
      quiescenceEffectId: effect('unused-quiescence')
    })

    expect(firstSettled.state.phase).toBe(ConversationPhase.Running)
    if (firstSettled.state.phase !== ConversationPhase.Running) throw new Error('sibling turn settled too early')
    expect(firstSettled.state.turn.executions.get(execution)?.phase).toBe(ConversationExecutionPhase.Settled)
    expect(firstSettled.state.turn.executions.get(secondExecution)?.phase).toBe(ConversationExecutionPhase.Starting)
    expect(firstSettled.effects).not.toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.PublishStatus })
    )

    const firstChunk = transitionConversation(firstSettled.state, {
      type: ConversationCommandType.ExecutionFirstChunk,
      turnId: turn,
      executionId: secondExecution,
      runEffectId: effect('run-2'),
      statusEffectId: effect('streaming-status')
    })
    expect(firstChunk.state.phase).toBe(ConversationPhase.Running)
    if (firstChunk.state.phase !== ConversationPhase.Running) throw new Error('sibling turn disappeared')
    expect(firstChunk.state.turn.executions.get(secondExecution)?.phase).toBe(ConversationExecutionPhase.Active)
    expect(firstChunk.effects).toEqual([
      expect.objectContaining({ type: ConversationEffectType.PublishStatus, effectId: effect('streaming-status') })
    ])
  })

  it('never chains a steer onto a multi-model turn that resolved to error, in either settle order', () => {
    const secondExecution = toConversationExecutionId('execution-2')
    for (const order of [
      [execution, secondExecution],
      [secondExecution, execution]
    ]) {
      let state = transitionConversation(createConversationState(chat), {
        type: ConversationCommandType.TurnCommitted,
        inputId: toConversationInputId('user-1'),
        inputIds: [toConversationInputId('user-1')],
        turnId: turn,
        turnKind: ConversationTurnKind.Submit,
        anchorNodeId: 'user-1',
        responder: ConversationResponderKind.Interactive,
        executions: [
          {
            id: execution,
            outputNodeId: 'assistant-1',
            driver: ConversationExecutionDriverKind.Chat,
            modelId: 'provider::model-a',
            startEffectId: effect('run-1')
          },
          {
            id: secondExecution,
            outputNodeId: 'assistant-2',
            driver: ConversationExecutionDriverKind.Chat,
            modelId: 'provider::model-b',
            startEffectId: effect('run-2')
          }
        ]
      }).state
      state = transitionConversation(state, {
        type: ConversationCommandType.InputCommitted,
        input: input('user-2'),
        yieldEffectId: effect('yield-1')
      }).state
      let finalTransition: ReturnType<typeof transitionConversation> | undefined
      for (const currentExecution of order) {
        const suffix = currentExecution === execution ? '1' : '2'
        const terminal = transitionConversation(state, {
          type: ConversationCommandType.ExecutionTerminal,
          turnId: turn,
          executionId: currentExecution,
          runEffectId: effect(`run-${suffix}`),
          outcome:
            currentExecution === execution
              ? { kind: ConversationOutcomeKind.Error, error: { name: 'Error', message: 'failed', stack: null } }
              : { kind: ConversationOutcomeKind.Success },
          persistenceEffectId: effect(`persist-${suffix}`)
        })
        finalTransition = transitionConversation(terminal.state, {
          type: ConversationCommandType.PersistenceSucceeded,
          turnId: turn,
          executionId: currentExecution,
          persistenceEffectId: effect(`persist-${suffix}`),
          statusEffectId: effect(`status-${suffix}`),
          executionTerminalEffectId: effect(`execution-terminal-${suffix}`),
          turnTerminalEffectId: effect(`turn-terminal-${suffix}`),
          quiescenceEffectId: effect(`quiescence-${suffix}`),
          scheduleEffectId: effect(`schedule-${suffix}`),
          scheduleStepEffectId: effect(`schedule-step-${suffix}`)
        })
        state = finalTransition.state
      }

      expect(finalTransition?.state).toMatchObject({
        phase: ConversationPhase.Idle,
        inbox: { nextTurn: [], nextStep: [] }
      })
      expect(finalTransition?.effects).toContainEqual(
        expect.objectContaining({ type: ConversationEffectType.DropInputs, inputs: [input('user-2')] })
      )
      expect(finalTransition?.effects).not.toContainEqual(
        expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn })
      )
    }
  })

  it('publishes each persistent approval id once', () => {
    const command = {
      type: ConversationCommandType.InteractionOpened as const,
      turnId: turn,
      interaction: {
        id: toConversationInteractionId('approval-1'),
        executionId: execution,
        kind: ConversationInteractionKind.ToolApproval,
        resumeMode: ConversationInteractionResumeMode.InPlace
      },
      statusEffectId: effect('interaction-status')
    }
    const first = transitionConversation(open(agent).state, command)
    const duplicate = transitionConversation(first.state, command)

    expect(first.effects).toEqual([expect.objectContaining({ type: ConversationEffectType.PublishStatus })])
    expect(duplicate.state).toBe(first.state)
    expect(duplicate.effects).toEqual([])
    expect(first.state.phase).toBe(ConversationPhase.Running)
    if (first.state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect([...first.state.turn.interactions.keys()]).toEqual([toConversationInteractionId('approval-1')])
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
      quiescenceEffectId: effect('quiescence-stop'),
      discardEffectId: effect('discard-stop'),
      dropEffectId: effect('drop-stop-inputs')
    })

    expect(stopped.state).toMatchObject({
      phase: ConversationPhase.Stopping,
      inbox: { nextTurn: [], nextStep: [] }
    })
    expect(stopped.effects).toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.AbortExecution, executionId: execution })
    )
  })

  it('Stop drains a Persisting resource without replacing its terminal outcome', () => {
    const persisting = transitionConversation(open(agent).state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Success },
      persistenceEffectId: effect('persist-running')
    }).state
    const stopped = transitionConversation(persisting, {
      type: ConversationCommandType.Stop,
      reason: 'user-stop',
      abortEffectIds: new Map([[execution, effect('abort-persisting')]]),
      persistenceEffectIds: new Map([[execution, effect('unused-persist')]]),
      turnTerminalEffectId: effect('turn-terminal-stop'),
      quiescenceEffectId: effect('quiescence-stop'),
      discardEffectId: effect('discard-stop'),
      dropEffectId: effect('drop-stop-inputs')
    })

    expect(stopped.effects).toEqual([
      expect.objectContaining({
        type: ConversationEffectType.AbortExecution,
        effectId: effect('abort-persisting'),
        executionId: execution
      }),
      expect.objectContaining({
        type: ConversationEffectType.FinalizeTerminalPersistence,
        effectId: effect('persist-running')
      })
    ])
    if (stopped.state.phase !== ConversationPhase.Stopping) throw new Error('Stop did not enter Stopping')
    expect(stopped.state.turn.executions.get(execution)).toMatchObject({
      phase: ConversationExecutionPhase.Persisting,
      outcome: { kind: ConversationOutcomeKind.Success }
    })
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
      quiescenceEffectId: effect('quiescence'),
      scheduleEffectId: effect('schedule')
    })

    expect(abandoned.effects).toContainEqual(
      expect.objectContaining({
        type: ConversationEffectType.PublishExecutionTerminal,
        durability: ConversationTerminalDurability.DeferredRecovery,
        audience: ConversationTerminalAudience.InternalOnly
      })
    )
  })

  it('moves an undelivered Agent redirect to NextTurn when persistence is abandoned', () => {
    let state = open(agent).state
    state = transitionConversation(state, {
      type: ConversationCommandType.InputCommitted,
      input: input('redirected'),
      runtimeCanRedirect: true,
      redirectEffectId: effect('redirect')
    }).state
    state = deliverRedirect(state, 'redirected')
    state = transitionConversation(state, {
      type: ConversationCommandType.ExecutionTerminal,
      turnId: turn,
      executionId: execution,
      runEffectId: effect('run-1'),
      outcome: { kind: ConversationOutcomeKind.Paused, reason: 'stopped' },
      persistenceEffectId: effect('persist')
    }).state

    const abandoned = transitionConversation(state, {
      type: ConversationCommandType.PersistenceAbandoned,
      turnId: turn,
      executionId: execution,
      persistenceEffectId: effect('persist'),
      executionTerminalEffectId: effect('execution-terminal'),
      turnTerminalEffectId: effect('turn-terminal'),
      quiescenceEffectId: effect('quiescence'),
      scheduleEffectId: effect('schedule')
    })

    expect(abandoned.state.inbox).toEqual({ nextStep: [], nextTurn: [input('redirected')] })
    expect(abandoned.effects).toContainEqual(
      expect.objectContaining({ type: ConversationEffectType.ScheduleNextTurn, inputs: [input('redirected')] })
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
