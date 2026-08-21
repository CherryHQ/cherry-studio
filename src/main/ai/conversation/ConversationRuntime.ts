import { serializeError } from '@main/ai/utils/serializeError'
import {
  type ConversationActivityId,
  type ConversationEffectId,
  type ConversationExecutionId,
  type ConversationInputId,
  type ConversationInteractionId,
  ConversationPhase,
  type ConversationRef,
  conversationRefKey,
  type ConversationTurnId,
  ConversationTurnKind,
  toConversationTurnId
} from '@shared/ai/conversation'

import {
  type ConversationExecutionSink,
  type ConversationPortResolver,
  type ConversationRuntimeIdFactory,
  ConversationTerminalPersistenceResultKind
} from './conversationPorts'
import type {
  ConversationActivity,
  ConversationCommand,
  ConversationEffect,
  ConversationExecutionPlan,
  ConversationInput,
  ConversationState,
  ConversationTransition
} from './conversationState'
import {
  ConversationCommandType,
  ConversationEffectType,
  createConversationState,
  isConversationQuiescent,
  transitionConversation
} from './conversationState'
import { ConversationTerminalPersistenceCoordinator } from './ConversationTerminalPersistenceCoordinator'

/** Single process-local command owner for Chat and Agent Conversation state. */
export class ConversationRuntime {
  private readonly states = new Map<string, ConversationState>()
  private readonly persistence = new ConversationTerminalPersistenceCoordinator()

  constructor(
    private readonly ports: ConversationPortResolver,
    private readonly ids: ConversationRuntimeIdFactory,
    private readonly onTransition?: (
      ref: ConversationRef,
      command: ConversationCommand,
      transition: ConversationTransition
    ) => void
  ) {}

  inspect(ref: ConversationRef): ConversationState {
    return this.states.get(conversationRefKey(ref)) ?? createConversationState(ref)
  }

  preview(ref: ConversationRef, command: ConversationCommand): ConversationTransition {
    return transitionConversation(this.inspect(ref), command)
  }

  openTurn(
    ref: ConversationRef,
    input: ConversationInput,
    executions: readonly ConversationExecutionPlan[],
    options: { turnId?: ConversationTurnId; turnKind?: ConversationTurnKind; anchorNodeId?: string | null } = {}
  ): ConversationTransition {
    return this.dispatch(ref, {
      type: ConversationCommandType.TurnCommitted,
      inputId: input.id,
      turnId: options.turnId ?? this.ids.turn(),
      turnKind: options.turnKind ?? ConversationTurnKind.Submit,
      anchorNodeId: options.anchorNodeId ?? null,
      responder: input.responder,
      executions
    })
  }

  commitInput(
    ref: ConversationRef,
    input: ConversationInput,
    options: {
      runtimeCanRedirect?: boolean
      yieldEffectId?: ConversationEffectId
      redirectEffectId?: ConversationEffectId
    } = {}
  ): ConversationTransition {
    return this.dispatch(ref, {
      type: ConversationCommandType.InputCommitted,
      input,
      yieldEffectId: options.yieldEffectId ?? this.ids.effect(),
      redirectEffectId: options.redirectEffectId ?? this.ids.effect(),
      runtimeCanRedirect: options.runtimeCanRedirect
    })
  }

  commitStep(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    inputId: ConversationInputId,
    executions: readonly ConversationExecutionPlan[]
  ): ConversationTransition {
    return this.dispatch(ref, { type: ConversationCommandType.StepCommitted, turnId, inputId, executions })
  }

  failStep(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    inputId: ConversationInputId,
    error: ReturnType<typeof serializeError>
  ): ConversationTransition {
    return this.dispatch(ref, {
      type: ConversationCommandType.StepFailed,
      turnId,
      inputId,
      error,
      turnTerminalEffectId: this.ids.effect(),
      quiescenceEffectId: this.ids.effect()
    })
  }

  stop(ref: ConversationRef, reason: string): ConversationTransition {
    const state = this.inspect(ref)
    const abortEffectIds = new Map<ConversationExecutionId, ConversationEffectId>()
    const persistenceEffectIds = new Map<ConversationExecutionId, ConversationEffectId>()
    if (state.phase === ConversationPhase.Running || state.phase === ConversationPhase.Stopping) {
      for (const execution of state.turn.executions.values()) {
        abortEffectIds.set(execution.id, this.ids.effect())
        persistenceEffectIds.set(execution.id, this.ids.effect())
      }
    }
    return this.dispatch(ref, {
      type: ConversationCommandType.Stop,
      reason,
      abortEffectIds,
      persistenceEffectIds,
      turnTerminalEffectId: this.ids.effect(),
      quiescenceEffectId: this.ids.effect()
    })
  }

  resolveInteraction(
    ref: ConversationRef,
    interactionId: ConversationInteractionId,
    resumeEffectId: ConversationEffectId = this.ids.effect(),
    statusEffectId: ConversationEffectId = this.ids.effect()
  ): ConversationTransition {
    const state = this.inspect(ref)
    if (state.phase !== ConversationPhase.Running) {
      return this.dispatch(ref, {
        type: ConversationCommandType.InteractionResolved,
        turnId: toConversationTurnId('stale'),
        interactionId,
        resumeEffectId,
        statusEffectId
      })
    }
    return this.dispatch(ref, {
      type: ConversationCommandType.InteractionResolved,
      turnId: state.turn.id,
      interactionId,
      resumeEffectId,
      statusEffectId
    })
  }

  rejectRedirectedInput(ref: ConversationRef, inputId: ConversationInput['id']): ConversationTransition {
    const state = this.inspect(ref)
    return this.dispatch(ref, {
      type: ConversationCommandType.RedirectRejected,
      turnId: state.phase === ConversationPhase.Running ? state.turn.id : toConversationTurnId('stale-redirect-result'),
      inputId
    })
  }

  addExecutions(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    executions: readonly ConversationExecutionPlan[]
  ): ConversationTransition {
    return this.dispatch(ref, { type: ConversationCommandType.ExecutionsAdded, turnId, executions })
  }

  openActivity(ref: ConversationRef, activity: ConversationActivity): ConversationTransition {
    return this.dispatch(ref, { type: ConversationCommandType.ActivityOpened, activity })
  }

  closeActivity(ref: ConversationRef, activityId: ConversationActivityId): ConversationTransition {
    return this.dispatch(ref, {
      type: ConversationCommandType.ActivityClosed,
      activityId,
      quiescenceEffectId: this.ids.effect()
    })
  }

  kickInbox(ref: ConversationRef): ConversationTransition {
    return this.dispatch(ref, { type: ConversationCommandType.KickInbox, scheduleEffectId: this.ids.effect() })
  }

  dispatch(ref: ConversationRef, command: ConversationCommand): ConversationTransition {
    const key = conversationRefKey(ref)
    const previous = this.states.get(key) ?? createConversationState(ref)
    const transition = transitionConversation(previous, command)
    this.states.set(key, transition.state)
    this.onTransition?.(ref, command, transition)
    for (const effect of transition.effects) this.execute(effect)
    return transition
  }

  retryBlockedPersistence(): void {
    this.persistence.retryBlocked()
  }

  inFlightPersistenceRuns(): readonly Promise<void>[] {
    return this.persistence.inFlightRuns()
  }

  forgetIfQuiescent(ref: ConversationRef, turnId: ConversationTurnId): boolean {
    const key = conversationRefKey(ref)
    const state = this.states.get(key)
    if (!state || state.lastTurnId !== turnId || !isConversationQuiescent(state)) return false
    this.states.delete(key)
    return true
  }

  private execute(effect: ConversationEffect): void {
    const ports = this.ports.resolve(effect.conversation)
    switch (effect.type) {
      case ConversationEffectType.StartExecution: {
        const sink = this.executionSink(effect.conversation, effect.turnId, effect.executionId, effect.effectId)
        try {
          ports.execution.start(effect, sink)
          if (effect.interactionId) {
            this.dispatch(effect.conversation, {
              type: ConversationCommandType.InteractionResumeSucceeded,
              turnId: effect.turnId,
              interactionId: effect.interactionId,
              resumeEffectId: effect.effectId,
              statusEffectId: this.ids.effect()
            })
          }
        } catch (error) {
          if (effect.interactionId) {
            this.dispatch(effect.conversation, {
              type: ConversationCommandType.InteractionResumeFailed,
              turnId: effect.turnId,
              interactionId: effect.interactionId,
              resumeEffectId: effect.effectId
            })
          } else {
            sink.startFailed(serializeError(error))
          }
        }
        return
      }

      case ConversationEffectType.RequestYield:
        ports.execution.requestYield(effect.conversation, effect.turnId)
        return

      case ConversationEffectType.RedirectInput:
        this.dispatch(effect.conversation, {
          type: ports.execution.redirect(effect)
            ? ConversationCommandType.RedirectAccepted
            : ConversationCommandType.RedirectRejected,
          turnId: effect.turnId,
          inputId: effect.input.id
        })
        return

      case ConversationEffectType.ResumeExecution:
        try {
          ports.execution.resume(effect)
          this.dispatch(effect.conversation, {
            type: ConversationCommandType.InteractionResumeSucceeded,
            turnId: effect.turnId,
            interactionId: effect.interactionId,
            resumeEffectId: effect.effectId,
            statusEffectId: this.ids.effect()
          })
        } catch {
          this.dispatch(effect.conversation, {
            type: ConversationCommandType.InteractionResumeFailed,
            turnId: effect.turnId,
            interactionId: effect.interactionId,
            resumeEffectId: effect.effectId
          })
        }
        return

      case ConversationEffectType.AbortExecution:
        ports.execution.abort(effect)
        return

      case ConversationEffectType.PersistTerminal:
        this.persistence.submit(
          effect,
          () => ports.terminalPersistence.persistTerminal(effect),
          (result) => {
            switch (result.kind) {
              case ConversationTerminalPersistenceResultKind.Durable:
                this.dispatch(effect.conversation, {
                  type: ConversationCommandType.PersistenceSucceeded,
                  turnId: effect.turnId,
                  executionId: effect.executionId,
                  persistenceEffectId: effect.effectId,
                  statusEffectId: this.ids.effect(),
                  executionTerminalEffectId: this.ids.effect(),
                  turnTerminalEffectId: this.ids.effect(),
                  quiescenceEffectId: this.ids.effect(),
                  scheduleEffectId: this.ids.effect(),
                  scheduleStepEffectId: this.ids.effect()
                })
                return
              case ConversationTerminalPersistenceResultKind.Failed:
                this.dispatch(effect.conversation, {
                  type: ConversationCommandType.PersistenceFailed,
                  turnId: effect.turnId,
                  executionId: effect.executionId,
                  persistenceEffectId: effect.effectId
                })
                if (this.inspect(effect.conversation).phase === ConversationPhase.Stopping) {
                  this.persistence.finalize(effect.effectId)
                }
                return
              case ConversationTerminalPersistenceResultKind.Abandoned:
                this.dispatch(effect.conversation, {
                  type: ConversationCommandType.PersistenceAbandoned,
                  turnId: effect.turnId,
                  executionId: effect.executionId,
                  persistenceEffectId: effect.effectId,
                  executionTerminalEffectId: this.ids.effect(),
                  turnTerminalEffectId: this.ids.effect(),
                  quiescenceEffectId: this.ids.effect()
                })
                return
            }
          }
        )
        return

      case ConversationEffectType.FinalizeTerminalPersistence:
        this.persistence.finalize(effect.effectId)
        return

      case ConversationEffectType.ScheduleNextTurn:
        ports.scheduleNextTurn(effect.conversation, effect.input)
        return

      case ConversationEffectType.ScheduleNextStep:
        ports.scheduleNextStep(effect.conversation, effect.turnId, effect.input)
        return

      case ConversationEffectType.PublishStatus:
        ports.presentation.publishStatus(effect)
        return

      case ConversationEffectType.PublishExecutionTerminal:
        ports.presentation.publishExecutionTerminal(effect)
        return

      case ConversationEffectType.PublishTurnTerminal:
        ports.presentation.publishTurnTerminal(effect)
        return

      case ConversationEffectType.PublishQuiescence:
        ports.presentation.publishQuiescence(effect.conversation, effect.turnId)
        return
    }
  }

  private executionSink(
    conversation: ConversationRef,
    turnId: ConversationTurnId,
    executionId: ConversationExecutionId,
    runEffectId: ConversationEffectId
  ): ConversationExecutionSink {
    return {
      firstChunk: () => {
        this.dispatch(conversation, {
          type: ConversationCommandType.ExecutionFirstChunk,
          turnId,
          executionId,
          runEffectId,
          statusEffectId: this.ids.effect()
        })
      },
      interactionOpened: (interaction) => {
        this.dispatch(conversation, {
          type: ConversationCommandType.InteractionOpened,
          turnId,
          interaction,
          statusEffectId: this.ids.effect()
        })
      },
      terminal: (outcome) => {
        this.dispatch(conversation, {
          type: ConversationCommandType.ExecutionTerminal,
          turnId,
          executionId,
          runEffectId,
          outcome,
          persistenceEffectId: this.ids.effect()
        })
      },
      startFailed: (error) => {
        this.dispatch(conversation, {
          type: ConversationCommandType.ExecutionStartFailed,
          turnId,
          executionId,
          runEffectId,
          error,
          persistenceEffectId: this.ids.effect()
        })
      }
    }
  }
}
