import { Mutex } from 'async-mutex'

import { application } from '@application'
import { type DispatchDecision, toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type {
  ComputerUseApp,
  ComputerUseApprovalRequest,
  ComputerUseApprovalScope
} from '@shared/ipc/schemas/computerUse'

export interface ComputerUseApprovalContext {
  sessionId: string
  topicId: string
  bypass: boolean
  windowId?: string
}

export interface ComputerUseAuthorization {
  current: () => ComputerUseApprovalContext
  waiting: (waiting: boolean) => void
}

interface PendingApproval {
  ownerId: string
  request: ComputerUseApprovalRequest
  windowId: string
  cancel: AbortController
  result: Promise<void>
}

export class ComputerUseApproval {
  private readonly grants = new Map<string, Set<string>>()
  private readonly pending = new Map<string, PendingApproval>()
  private readonly writes = new Mutex()

  constructor(private readonly changed: () => void) {}

  list(windowId: string | null): ComputerUseApprovalRequest[] {
    return [...this.pending.values()].filter((entry) => entry.windowId === windowId).map((entry) => entry.request)
  }

  respond(approvalId: string, scope: ComputerUseApprovalScope, windowId: string | null): boolean {
    const pending = [...this.pending.values()].find((entry) => entry.request.approvalId === approvalId)
    if (!pending || pending.windowId !== windowId || pending.cancel.signal.aborted) return false
    return !!toolApprovalRegistry.dispatch(approvalId, { approved: scope !== 'reject', applicationScope: scope })
  }

  async authorize(
    ownerId: string,
    app: ComputerUseApp,
    authorization: ComputerUseAuthorization | undefined,
    signal: AbortSignal
  ): Promise<void> {
    signal.throwIfAborted()
    if (!authorization) throw new Error('Application approval context is unavailable')
    const context = authorization.current()
    if (context.bypass) return
    const identity = app.identity
    if (!identity) throw new Error('Cannot approve an application without a stable native identity')
    const preferences = application.get('PreferenceService')
    if (preferences.get('app.computer_use.approved_apps').includes(identity) || this.grants.get(ownerId)?.has(identity))
      return
    if (!context.windowId) throw new Error('Application approval requires an interactive conversation')
    const key = JSON.stringify([ownerId, identity])
    const existing = this.pending.get(key)
    if (existing) {
      const cancel = () => existing.cancel.abort()
      signal.addEventListener('abort', cancel, { once: true })
      authorization.waiting(true)
      try {
        await existing.result
        signal.throwIfAborted()
        return
      } finally {
        signal.removeEventListener('abort', cancel)
        authorization.waiting(false)
      }
    }

    const cancel = new AbortController()
    const approvalSignal = AbortSignal.any([signal, cancel.signal])
    const approvalId = crypto.randomUUID()
    const decision = Promise.withResolvers<DispatchDecision>()
    const request = { approvalId, topicId: context.topicId, app }
    const result = decision.promise
      .then(async (answer) => {
        approvalSignal.throwIfAborted()
        if (!answer.approved || !answer.applicationScope || answer.applicationScope === 'reject')
          throw new Error('The user rejected access to this application')
        await this.writes.runExclusive(async () => {
          approvalSignal.throwIfAborted()
          authorization.current()
          if (answer.applicationScope === 'always') {
            const approved = preferences.get('app.computer_use.approved_apps')
            if (!approved.includes(identity))
              await preferences.set('app.computer_use.approved_apps', [...approved, identity])
          } else {
            const grants = this.grants.get(ownerId) ?? new Set<string>()
            grants.add(identity)
            this.grants.set(ownerId, grants)
          }
        })
        approvalSignal.throwIfAborted()
      })
      .finally(() => {
        this.pending.delete(key)
        authorization.waiting(false)
        this.changed()
      })
    this.pending.set(key, { ownerId, request, windowId: context.windowId, cancel, result })
    authorization.waiting(true)
    toolApprovalRegistry.register({
      approvalId,
      sessionId: context.sessionId,
      toolCallId: approvalId,
      toolName: 'computer_use_app',
      originalInput: { identity },
      presentation: 'application',
      signal: approvalSignal,
      resolve: decision.resolve
    })
    this.changed()
    return result
  }

  async revoke(identity: string): Promise<void> {
    await this.writes.runExclusive(async () => {
      const preferences = application.get('PreferenceService')
      await preferences.set(
        'app.computer_use.approved_apps',
        preferences.get('app.computer_use.approved_apps').filter((app) => app !== identity)
      )
    })
  }

  cancel(ownerId: string, appId: string): void {
    for (const pending of this.pending.values()) {
      if (pending.ownerId === ownerId && (pending.request.app.id === appId || pending.request.app.identity === appId))
        pending.cancel.abort()
    }
  }

  clear(ownerId?: string): void {
    if (ownerId === undefined) this.grants.clear()
    else this.grants.delete(ownerId)
    for (const pending of this.pending.values()) {
      if (ownerId === undefined || pending.ownerId === ownerId) pending.cancel.abort()
    }
  }
}
