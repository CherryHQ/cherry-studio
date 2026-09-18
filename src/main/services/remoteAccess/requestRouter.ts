import { ZodError } from 'zod'

import {
  authorize,
  type DeviceContext,
  getInteraction,
  getMessagePart,
  listAgents,
  listInteractions,
  listMessageParts,
  listMessages,
  listSessions,
  listWorkspaces,
  readArtifact,
  sessionSnapshot,
  translateAgentError
} from './agentAccess'
import { cancelTurn, createSession, getCommand, respondInteraction, sendMessage } from './agentCommands'
import { methodSchemas, type RemoteErrorCode, type RemoteMethod, RemoteRequestError, requestSchema } from './protocol'
import { RemoteAgentSubscription } from './RemoteAgentSubscription'

function remoteError(error: unknown): { code: RemoteErrorCode; retryable: boolean } {
  if (error instanceof RemoteRequestError) return { code: error.code, retryable: error.retryable }
  if (error instanceof ZodError) return { code: 'INVALID_REQUEST', retryable: false }
  return { code: translateAgentError(error) ?? 'INTERNAL_ERROR', retryable: false }
}

export class RequestRouter {
  private readonly subscriptions = new Map<string, RemoteAgentSubscription>()
  private readonly seen = new Set<string>()
  private readonly inFlight = new Set<Promise<void>>()
  private regular = 0
  private control = 0
  private disposed = false

  constructor(
    private readonly context: DeviceContext,
    private readonly instanceId: string,
    private readonly send: (value: unknown) => void,
    private readonly close: () => void
  ) {}

  receive(value: unknown): void {
    if (this.disposed) return
    const parsed = requestSchema.safeParse(value)
    if (!parsed.success) {
      this.close()
      return
    }
    const request = parsed.data
    if (this.seen.has(request.requestId) || this.seen.size >= 8192) {
      this.close()
      return
    }
    this.seen.add(request.requestId)
    const control = request.method === 'turns.cancel' || request.method === 'interactions.respond'
    if (control ? this.control >= 2 : this.regular >= 8) {
      this.send({
        type: 'response',
        requestId: request.requestId,
        error: { code: 'RATE_LIMITED' satisfies RemoteErrorCode, retryable: true }
      })
      return
    }
    if (control) this.control++
    else this.regular++
    const work = (async () => {
      try {
        authorize(this.context)
        if (!Object.hasOwn(methodSchemas, request.method)) throw new RemoteRequestError('METHOD_NOT_FOUND')
        const result = await this.dispatch(request.method as RemoteMethod, request.params ?? {})
        if (this.disposed) return
        authorize(this.context)
        this.send({ type: 'response', requestId: request.requestId, result })
      } catch (error) {
        if (!this.disposed) this.send({ type: 'response', requestId: request.requestId, error: remoteError(error) })
      } finally {
        if (control) this.control--
        else this.regular--
      }
    })()
    this.inFlight.add(work)
    void work.finally(() => this.inFlight.delete(work))
  }

  private dispatch(method: RemoteMethod, params: unknown): unknown | Promise<unknown> {
    const context = this.context
    switch (method) {
      case 'system.info':
        methodSchemas[method].parse(params)
        return {
          instanceId: this.instanceId,
          protocolVersion: 1,
          capabilities: [
            'agents',
            'workspaces',
            'text',
            'session-snapshots',
            'tool-approval',
            'cancel',
            'command-receipts',
            'message-details',
            'artifact-markers',
            'artifact-download',
            'interaction-details'
          ]
        }
      case 'agents.list':
        return listAgents(context, methodSchemas[method].parse(params))
      case 'workspaces.list':
        return listWorkspaces(context, methodSchemas[method].parse(params))
      case 'sessions.list':
        return listSessions(context, methodSchemas[method].parse(params))
      case 'sessions.create':
        return createSession(context, methodSchemas[method].parse(params))
      case 'sessions.get':
        return sessionSnapshot(context, methodSchemas[method].parse(params).sessionId)
      case 'messages.list':
        return listMessages(context, methodSchemas[method].parse(params))
      case 'messages.parts.list':
        return listMessageParts(context, methodSchemas[method].parse(params))
      case 'messages.parts.get':
        return getMessagePart(context, methodSchemas[method].parse(params))
      case 'artifacts.read':
        return readArtifact(context, methodSchemas[method].parse(params))
      case 'messages.send':
        return sendMessage(context, methodSchemas[method].parse(params))
      case 'commands.get':
        return getCommand(context, methodSchemas[method].parse(params).commandId)
      case 'turns.cancel':
        return cancelTurn(context, methodSchemas[method].parse(params))
      case 'interactions.list':
        return { items: listInteractions(context, methodSchemas[method].parse(params).sessionId) }
      case 'interactions.get':
        return getInteraction(context, methodSchemas[method].parse(params))
      case 'interactions.respond':
        return respondInteraction(context, methodSchemas[method].parse(params))
      case 'session.subscribe': {
        const { sessionId } = methodSchemas[method].parse(params)
        const existing = [...this.subscriptions.values()].find((item) => item.sessionId === sessionId)
        if (existing) return { subscriptionId: existing.id }
        if (this.subscriptions.size >= 4) throw new RemoteRequestError('SUBSCRIPTION_LIMIT')
        const subscription = new RemoteAgentSubscription(sessionId, context, this.send, this.close)
        this.subscriptions.set(subscription.id, subscription)
        return { subscriptionId: subscription.id }
      }
      case 'unsubscribe': {
        const { subscriptionId } = methodSchemas[method].parse(params)
        this.subscriptions.get(subscriptionId)?.dispose()
        this.subscriptions.delete(subscriptionId)
        return { unsubscribed: true }
      }
      default:
        method satisfies never
        throw new RemoteRequestError('METHOD_NOT_FOUND')
    }
  }

  get isBusy(): boolean {
    return this.inFlight.size > 0
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlight])
  }

  dispose(): void {
    this.disposed = true
    for (const subscription of this.subscriptions.values()) subscription.dispose()
    this.subscriptions.clear()
  }
}
