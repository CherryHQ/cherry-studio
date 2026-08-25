import { serializeError } from '@main/ai/utils/serializeError'
import {
  type ConversationEffectId,
  type ConversationExecutionId,
  type ConversationRef,
  conversationRefsEqual,
  type ConversationTurnId
} from '@shared/ai/conversation'

import { AgentRuntimeRedirectReceiptKind } from '../runtime/types'
import {
  ConversationExecutionAbortResultKind,
  type ConversationExecutionSink,
  type ConversationPortResolver,
  type ConversationRuntimeIdFactory,
  ConversationTerminalPersistenceResultKind
} from './conversationPorts'
import {
  type ConversationCommand,
  ConversationCommandType,
  type ConversationEffect,
  ConversationEffectType
} from './conversationState'
import { ConversationTerminalPersistenceCoordinator } from './ConversationTerminalPersistenceCoordinator'

type DeferredResumeEffect = Extract<
  ConversationEffect,
  { readonly type: ConversationEffectType.ResumeSuspendedExecution }
>

export interface ConversationEffectSchedulePolicy {
  readonly shouldDeferResume: () => boolean
  readonly isResumeApplicable: (effect: DeferredResumeEffect) => boolean
  readonly trackOperation: (id: string, task: () => Promise<void>) => Promise<void>
}

/** Executes committed effects and reports exact result commands to one Conversation actor. */
export class ConversationEffectExecutor {
  private readonly persistence = new ConversationTerminalPersistenceCoordinator()
  private readonly deferredResumes = new Map<ConversationEffectId, DeferredResumeEffect>()

  constructor(
    private readonly conversation: ConversationRef,
    private readonly ports: ConversationPortResolver,
    private readonly ids: ConversationRuntimeIdFactory,
    private readonly dispatch: (command: ConversationCommand) => void,
    private readonly schedulePolicy?: ConversationEffectSchedulePolicy
  ) {}

  execute(effect: ConversationEffect): void {
    const ports = this.ports.resolve(this.conversation)
    switch (effect.type) {
      case ConversationEffectType.StartExecution: {
        const sink = this.executionSink(effect.turnId, effect.executionId, effect.effectId)
        try {
          ports.execution.start(effect, sink)
          if (effect.interactionId) {
            this.dispatch({
              type: ConversationCommandType.InteractionResumeSucceeded,
              turnId: effect.turnId,
              interactionId: effect.interactionId,
              resumeEffectId: effect.effectId,
              statusEffectId: this.ids.effect()
            })
          }
        } catch (error) {
          if (effect.interactionId) {
            this.dispatch({
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

      case ConversationEffectType.RedirectInput: {
        const receipt = ports.execution.redirect(effect)
        this.dispatch({
          type:
            receipt.kind === AgentRuntimeRedirectReceiptKind.Queued
              ? ConversationCommandType.RedirectQueued
              : ConversationCommandType.RedirectRejected,
          turnId: effect.turnId,
          inputId: effect.input.id
        })
        return
      }

      case ConversationEffectType.ResumeExecution:
        try {
          ports.execution.resume(effect)
          this.dispatch({
            type: ConversationCommandType.InteractionResumeSucceeded,
            turnId: effect.turnId,
            interactionId: effect.interactionId,
            resumeEffectId: effect.effectId,
            statusEffectId: this.ids.effect()
          })
        } catch {
          this.dispatch({
            type: ConversationCommandType.InteractionResumeFailed,
            turnId: effect.turnId,
            interactionId: effect.interactionId,
            resumeEffectId: effect.effectId
          })
        }
        return

      case ConversationEffectType.SuspendExecution: {
        let suspended = false
        try {
          suspended = ports.execution.suspend(effect)
        } catch {
          suspended = false
        }
        this.dispatch(
          suspended
            ? {
                type: ConversationCommandType.RuntimeSuspensionSucceeded,
                suspendEffectId: effect.effectId,
                scheduleEffectId: this.ids.effect()
              }
            : {
                type: ConversationCommandType.RuntimeSuspensionFailed,
                suspendEffectId: effect.effectId,
                discardEffectId: this.ids.effect()
              }
        )
        return
      }

      case ConversationEffectType.ResumeSuspendedExecution:
        if (this.schedulePolicy?.shouldDeferResume()) {
          this.deferredResumes.set(effect.effectId, effect)
          return
        }
        this.resumeSuspended(effect)
        return

      case ConversationEffectType.DiscardRuntimeBuffer:
        ports.execution.discardRuntimeBuffer(effect)
        return

      case ConversationEffectType.ScheduleRuntimeTurn:
        ports.scheduleRuntimeTurn(effect.conversation, effect.input, effect.suspendEffectId)
        return

      case ConversationEffectType.AbortExecution: {
        const handle = ports.execution.abort(effect)
        void this.schedulePolicy?.trackOperation(`abort:${effect.effectId}`, async () => {
          const result = await handle.completed
          if (
            !conversationRefsEqual(result.conversation, effect.conversation) ||
            result.turnId !== effect.turnId ||
            result.executionId !== effect.executionId ||
            result.effectId !== effect.effectId
          ) {
            throw new Error(`Conversation execution teardown returned a stale identity: ${effect.effectId}`)
          }
          if (result.kind === ConversationExecutionAbortResultKind.Failed) {
            throw new Error(result.error.message ?? 'Conversation execution teardown failed')
          }
        })
        return
      }

      case ConversationEffectType.PersistTerminal:
        this.persistence.submit(
          effect,
          () => ports.terminalPersistence.persistTerminal(effect),
          (result) => {
            switch (result.kind) {
              case ConversationTerminalPersistenceResultKind.Durable:
                this.dispatch({
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
                this.dispatch({
                  type: ConversationCommandType.PersistenceFailed,
                  turnId: effect.turnId,
                  executionId: effect.executionId,
                  persistenceEffectId: effect.effectId
                })
                return
              case ConversationTerminalPersistenceResultKind.Abandoned:
                this.dispatch({
                  type: ConversationCommandType.PersistenceAbandoned,
                  turnId: effect.turnId,
                  executionId: effect.executionId,
                  persistenceEffectId: effect.effectId,
                  executionTerminalEffectId: this.ids.effect(),
                  turnTerminalEffectId: this.ids.effect(),
                  quiescenceEffectId: this.ids.effect(),
                  scheduleEffectId: this.ids.effect()
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
        ports.scheduleNextTurn(effect.conversation, effect.turnId, effect.inputs)
        return

      case ConversationEffectType.ScheduleNextStep:
        ports.scheduleNextStep(effect.conversation, effect.turnId, effect.inputs)
        return

      case ConversationEffectType.DropInputs:
        ports.dropInputs(effect.conversation, effect.inputs)
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

  retryBlockedPersistence(): void {
    this.persistence.retryBlocked()
  }

  inFlightPersistenceOperations() {
    return this.persistence.inFlightOperations()
  }

  reconcileDeferredEffects(): void {
    if (!this.schedulePolicy) return
    for (const [effectId, effect] of this.deferredResumes) {
      if (!this.schedulePolicy.isResumeApplicable(effect)) this.deferredResumes.delete(effectId)
    }
  }

  flushDeferredEffects(): void {
    if (!this.schedulePolicy || this.schedulePolicy.shouldDeferResume()) return
    this.reconcileDeferredEffects()
    const resumptions = [...this.deferredResumes.values()]
    this.deferredResumes.clear()
    for (const effect of resumptions) this.resumeSuspended(effect)
  }

  private resumeSuspended(effect: DeferredResumeEffect): void {
    try {
      this.ports.resolve(this.conversation).execution.resumeSuspended(effect)
    } catch (error) {
      this.dispatch({
        type: ConversationCommandType.ExecutionStartFailed,
        turnId: effect.turnId,
        executionId: effect.executionId,
        runEffectId: effect.runEffectId,
        error: serializeError(error),
        persistenceEffectId: this.ids.effect()
      })
    }
  }

  private executionSink(
    turnId: ConversationTurnId,
    executionId: ConversationExecutionId,
    runEffectId: ConversationEffectId
  ): ConversationExecutionSink {
    return {
      firstChunk: () => {
        this.dispatch({
          type: ConversationCommandType.ExecutionFirstChunk,
          turnId,
          executionId,
          runEffectId,
          statusEffectId: this.ids.effect()
        })
      },
      interactionOpened: (interaction) => {
        this.dispatch({
          type: ConversationCommandType.InteractionOpened,
          turnId,
          interaction,
          statusEffectId: this.ids.effect()
        })
      },
      interactionCompleted: (interactionId) => {
        this.dispatch({
          type: ConversationCommandType.InteractionCompleted,
          turnId,
          executionId,
          interactionId,
          runEffectId,
          statusEffectId: this.ids.effect()
        })
      },
      terminal: (outcome) => {
        this.dispatch({
          type: ConversationCommandType.ExecutionTerminal,
          turnId,
          executionId,
          runEffectId,
          outcome,
          persistenceEffectId: this.ids.effect()
        })
      },
      startFailed: (error) => {
        this.dispatch({
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
