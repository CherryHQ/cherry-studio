import type { ConversationRef } from '@shared/ai/conversation'

export enum ConversationActorCommandType {
  Admission = 'admission'
}

export enum ConversationAdmissionOperationKind {
  Dispatch = 'dispatch',
  Interaction = 'interaction',
  RuntimeContinuation = 'runtime-continuation'
}

export type ConversationAdmissionOperationId = string & {
  readonly __conversationAdmissionOperationId: unique symbol
}

export interface ConversationAdmissionContext {
  readonly id: ConversationAdmissionOperationId
  readonly sequence: number
  readonly signal: AbortSignal
  assertCurrent(): void
}

export class StaleConversationAdmissionError extends Error {
  constructor(readonly conversation: ConversationRef) {
    super(`Conversation admission was superseded: ${conversation.kind}:${conversation.id}`)
    this.name = 'StaleConversationAdmissionError'
  }
}

interface ConversationAdmissionOperation {
  readonly id: ConversationAdmissionOperationId
  readonly kind: ConversationAdmissionOperationKind
  readonly sequence: number
  readonly epoch: number
  controller?: AbortController
}

/** Owns the FIFO and cancellation boundary for one Conversation's pre-commit work. */
export class ConversationActor {
  private tail: Promise<void> = Promise.resolve()
  private readonly operations = new Map<ConversationAdmissionOperationId, ConversationAdmissionOperation>()
  private epoch = 0
  private nextSequence = 0

  constructor(
    readonly conversation: ConversationRef,
    private readonly onIdle: () => void
  ) {}

  enqueue<T>(
    kind: ConversationAdmissionOperationKind,
    task: (context: ConversationAdmissionContext) => Promise<T> | T
  ): Promise<T> {
    const operation: ConversationAdmissionOperation = {
      id: crypto.randomUUID() as ConversationAdmissionOperationId,
      kind,
      sequence: ++this.nextSequence,
      epoch: this.epoch
    }
    this.operations.set(operation.id, operation)
    const run = this.tail.then(async () => {
      this.assertCurrent(operation)
      const controller = new AbortController()
      operation.controller = controller
      const context: ConversationAdmissionContext = {
        id: operation.id,
        sequence: operation.sequence,
        signal: controller.signal,
        assertCurrent: () => this.assertCurrent(operation)
      }
      try {
        const result = await task(context)
        context.assertCurrent()
        return result
      } finally {
        this.operations.delete(operation.id)
        if (this.operations.size === 0) this.onIdle()
      }
    })
    this.tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  interrupt(reason: string): void {
    this.epoch += 1
    for (const operation of this.operations.values()) operation.controller?.abort(reason)
  }

  get hasPendingAdmissions(): boolean {
    return this.operations.size > 0
  }

  get inFlightAdmission(): Promise<void> {
    return this.tail
  }

  private assertCurrent(operation: ConversationAdmissionOperation): void {
    if (operation.epoch !== this.epoch || !this.operations.has(operation.id) || operation.controller?.signal.aborted) {
      this.operations.delete(operation.id)
      if (this.operations.size === 0) this.onIdle()
      throw new StaleConversationAdmissionError(this.conversation)
    }
  }
}
