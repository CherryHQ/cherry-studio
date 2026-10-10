import { randomUUID } from 'node:crypto'

import { application } from '@application'
import type { RemoteFailure } from '@cherrystudio/remote-protocol'
import {
  type AgentInteraction,
  type AgentMethod,
  agentMethods,
  type AgentMutation,
  type AgentParams,
  type AgentResult,
  type CommandReceipt,
  questionInputSchema,
  encodeAgentCommand
} from '@cherrystudio/remote-protocol/agent'
import { RemoteRpcError, type RemoteRpcServer } from '@cherrystudio/remote-transport'
import { AgentSessionDeliveryRoutingError } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { remoteCommandService, type RemoteCommandOutcome } from '@data/services/RemoteCommandService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { serializeError } from '@main/ai/utils/serializeError'
import { toExecutionFailure } from '@shared/ai/executionFailure'

import type { RemoteAgentHub } from './agentJournal'
import {
  createSessionTx,
  getSession,
  listAgents,
  listMessages,
  listParts,
  listPersistedInteractions,
  listSessions,
  listWorkspaces,
  pageOf,
  readPersistedContent,
  sha256,
  sliceContent,
  toSessionSummary
} from './agentQueries'
import type { AgentSubscriptions } from './agentSubscriptions'

const logger = loggerService.withContext('RemoteAgentHandlers')

export interface AgentAccess {
  requireAgent(): { deviceId: string; grantId: string }
  /** Runs after the pending reply has been queued to the wire, so activation never leaks events ahead of its response. */
  afterReply(fn: () => void): void
}

type Auth = ReturnType<AgentAccess['requireAgent']>

export function registerAgentMethods(
  rpc: RemoteRpcServer<void>,
  access: AgentAccess,
  hub: RemoteAgentHub,
  subscriptions: AgentSubscriptions
): void {
  const on = <M extends AgentMethod>(
    name: M,
    handler: (params: AgentParams<M>, auth: Auth) => AgentResult<M> | Promise<AgentResult<M>>
  ) =>
    rpc.addMethod<AgentParams<M>, AgentResult<M>>(name, agentMethods[name] as never, (params) =>
      handler(params, access.requireAgent())
    )

  const summaryOf = (sessionId: string) => {
    const summary = toSessionSummary(getSession(sessionId), hub.activeExecutionId(sessionId))
    if (!summary) throw new RemoteRpcError('NOT_FOUND', 'Session not found')
    return summary
  }

  const interactionsOf = (sessionId: string): AgentInteraction[] => {
    const journal = hub.journal(sessionId)
    const interactions = new Map(journal.interactions().map((item) => [item.interactionId, item]))
    const seen = new Set<string>()
    for (const item of listPersistedInteractions(sessionId)) {
      if (seen.has(item.interactionId)) continue
      seen.add(item.interactionId)
      const live = interactions.get(item.interactionId)
      if (
        !live ||
        live.executionId !== journal.activeExecutionId ||
        (live.status === 'pending' && item.status !== 'pending')
      )
        interactions.set(item.interactionId, item)
    }
    return [...interactions.values()]
  }

  /** Same device + grant + commandId with the same body returns the recorded receipt; the owner runs at most once. */
  const command = async <M extends AgentMutation>(
    auth: Auth,
    method: M,
    params: AgentParams<M>,
    sessionId: string | undefined,
    run: () => Promise<RemoteCommandOutcome>
  ): Promise<CommandReceipt> => {
    const key = { deviceId: auth.deviceId, grantId: auth.grantId, commandId: params.commandId }
    const admission = remoteCommandService.admit(key, {
      method,
      identityDigest: sha256(encodeAgentCommand(method, params)),
      sessionId
    })
    if (admission.kind === 'exhausted')
      throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Command receipt capacity reached for this device or desktop')
    if (admission.kind === 'conflict')
      throw new RemoteRpcError('IDEMPOTENCY_CONFLICT', 'Command body differs from the recorded command')
    if (admission.kind === 'existing') return admission.receipt
    let outcome: RemoteCommandOutcome
    try {
      outcome = await run()
    } catch (error) {
      if (error instanceof RemoteRpcError) outcome = { status: 'rejected', error: error.data as RemoteFailure }
      else if (error instanceof AgentSessionDeliveryRoutingError && error.code === 'TARGET_UNAVAILABLE') {
        outcome = {
          status: 'rejected',
          error: { reason: 'TARGET_UNAVAILABLE', message: toExecutionFailure(serializeError(error)).message }
        }
      } else {
        logger.error('Remote command failed before settling', error as Error)
        outcome = {
          status: 'interrupted',
          error: { reason: 'INTERNAL', message: 'Command failed before its outcome was known' }
        }
      }
    }
    return remoteCommandService.settle(key, outcome)
  }

  on('agent.agents.list', ({ cursor, limit }) => listAgents(cursor, limit))
  on('agent.workspaces.list', ({ agentId, cursor, limit }) => listWorkspaces(agentId, cursor, limit))
  on('agent.sessions.list', (params) => {
    const page = listSessions(params)
    return {
      items: page.items.flatMap((session) => toSessionSummary(session, hub.activeExecutionId(session.id)) ?? []),
      nextCursor: page.nextCursor
    }
  })
  on('agent.sessions.get', ({ sessionId }) => ({ session: summaryOf(sessionId) }))
  on('agent.sessions.create', (params, auth) => {
    const method = 'agent.sessions.create'
    let admission
    try {
      admission = remoteCommandService.apply(
        { ...auth, commandId: params.commandId },
        {
          method,
          identityDigest: sha256(encodeAgentCommand(method, params))
        },
        (tx) => {
          const sessionId = randomUUID()
          createSessionTx(tx, sessionId, params)
          return { status: 'applied', sessionId, result: { sessionId } }
        }
      )
    } catch (error) {
      return command(auth, method, params, undefined, async () => {
        throw error
      })
    }
    if (admission.kind === 'exhausted')
      throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Command receipt capacity reached for this device or desktop')
    if (admission.kind === 'conflict')
      throw new RemoteRpcError('IDEMPOTENCY_CONFLICT', 'Command body differs from the recorded command')
    if (admission.kind === 'accepted' && admission.receipt.sessionId)
      agentSessionService.notifyReadModelChange([admission.receipt.sessionId], 'membership')
    return admission.receipt
  })
  on('agent.messages.list', ({ sessionId, historyRevision, cursor, limit }) =>
    listMessages(sessionId, historyRevision, cursor, limit)
  )
  on('agent.parts.list', ({ sessionId, messageId, messageRevision, cursor, limit }) =>
    listParts(sessionId, messageId, messageRevision, cursor, limit)
  )
  on('agent.content.read', ({ sessionId, contentId, revision, offset, maxBytes }) => {
    getSession(sessionId)
    const bytes =
      hub.journal(sessionId).pins.get(`${contentId}:${revision}`) ??
      subscriptions.readContent(sessionId, contentId, revision) ??
      readPersistedContent(sessionId, contentId, revision)
    if (!bytes) throw new RemoteRpcError('NOT_FOUND', 'Content not found')
    return { contentId, revision, ...sliceContent(bytes, offset, maxBytes) }
  })
  on('agent.messages.send', (params, auth) => {
    const summary = summaryOf(params.sessionId)
    return command(auth, 'agent.messages.send', params, params.sessionId, async () => {
      const started = await hub.journal(params.sessionId).startRun(
        params.text,
        summary.agentId,
        (tx, reservation) =>
          remoteCommandService.reserveExecutionTx(tx, { ...auth, commandId: params.commandId }, reservation),
        () => {
          if (summaryOf(params.sessionId).idleRevision !== params.expectedIdleRevision)
            throw new RemoteRpcError('CONFLICT', 'Session is not idle at the expected revision')
        }
      )
      if (!started.started)
        return {
          status: 'rejected',
          error:
            started.reason === 'busy'
              ? { reason: 'CONFLICT', message: 'Session is busy' }
              : { reason: 'NOT_FOUND', message: 'Session is not available' }
        }
      return { status: 'applied', executionId: started.executionId }
    })
  })
  on('agent.executions.cancel', (params, auth) => {
    getSession(params.sessionId)
    return command(auth, 'agent.executions.cancel', params, params.sessionId, async () => {
      await application
        .get('AiStreamManager')
        .abortAndDrain(buildAgentSessionTopicId(params.sessionId), 'remote-cancel', () => {
          if (hub.journal(params.sessionId).activeExecutionId !== params.expectedExecutionId)
            throw new RemoteRpcError('CONFLICT', 'Execution is not active')
        })
      return {
        status: 'applied',
        executionId: params.expectedExecutionId,
        result: { executionId: params.expectedExecutionId, disposition: 'cancelled' }
      }
    })
  })
  on('agent.interactions.list', ({ sessionId, cursor, limit }) => {
    getSession(sessionId)
    return pageOf(interactionsOf(sessionId), cursor, limit)
  })
  on('agent.interactions.get', ({ sessionId, interactionId }) => {
    getSession(sessionId)
    const interaction = interactionsOf(sessionId).find((item) => item.interactionId === interactionId)
    if (!interaction) throw new RemoteRpcError('NOT_FOUND', 'Interaction not found')
    return { interaction }
  })
  on('agent.interactions.respond', (params, auth) => {
    getSession(params.sessionId)
    return command(auth, 'agent.interactions.respond', params, params.sessionId, async () => {
      const journal = hub.journal(params.sessionId)
      const interaction = interactionsOf(params.sessionId).find((item) => item.interactionId === params.interactionId)
      if (
        !interaction ||
        interaction.status !== 'pending' ||
        interaction.revision !== params.expectedRevision ||
        interaction.executionId !== params.expectedExecutionId ||
        interaction.inputDigest !== params.inputDigest
      ) {
        return { status: 'rejected', error: { reason: 'CONFLICT', message: 'Interaction changed since it was read' } }
      }
      const anchorId = journal.liveInteraction(params.interactionId)?.messageId ?? interaction.executionId
      const response = 'response' in params ? params.response : { kind: params.decision }
      const approved = response.kind !== 'deny'
      let updatedInput: Record<string, unknown> | undefined
      if (response.kind === 'answer') {
        if (interaction.kind !== 'question')
          return { status: 'rejected', error: { reason: 'CONFLICT', message: 'Interaction does not accept answers' } }
        const bytes =
          'text' in interaction.input
            ? interaction.input.text
            : new TextDecoder().decode(
                journal.pins.get(`${interaction.input.ref.contentId}:${interaction.input.ref.revision}`) ??
                  readPersistedContent(
                    params.sessionId,
                    interaction.input.ref.contentId,
                    interaction.input.ref.revision
                  )
              )
        const input = questionInputSchema.safeParse(JSON.parse(bytes))
        if (
          !input.success ||
          Object.keys(response.answers).length !== input.data.questions.length ||
          input.data.questions.some(
            (question) =>
              !Object.hasOwn(response.answers, question.question) || !response.answers[question.question].trim()
          )
        )
          return { status: 'rejected', error: { reason: 'CONFLICT', message: 'Every question requires an answer' } }
        updatedInput = { ...input.data, answers: response.answers }
      } else if (response.kind === 'approve' && interaction.kind === 'question') {
        return { status: 'rejected', error: { reason: 'CONFLICT', message: 'Question requires answers' } }
      }
      const decision = {
        approved,
        ...(updatedInput ? { updatedInput } : {}),
        ...('reason' in response ? { reason: response.reason } : {})
      }
      if (
        !application.get('AgentSessionRuntimeService').respondToolApproval(params.interactionId, decision, anchorId)
      ) {
        return { status: 'rejected', error: { reason: 'NOT_FOUND', message: 'Interaction is no longer pending' } }
      }
      journal.markInteraction(params.interactionId, approved ? 'approved' : 'denied')
      return {
        status: 'applied',
        executionId: interaction.executionId,
        result: { interactionId: params.interactionId, decision: approved ? 'approve' : 'deny' }
      }
    })
  })
  on('agent.commands.get', ({ commandId }, auth) => {
    const receipt = remoteCommandService.get({ deviceId: auth.deviceId, grantId: auth.grantId, commandId })
    if (!receipt) throw new RemoteRpcError('NOT_FOUND', 'Command not found')
    return receipt
  })
  on('agent.sessions.subscribe', (params) => {
    getSession(params.sessionId)
    return subscriptions.subscribe(params)
  })
  on('agent.checkpoints.read', (params) => subscriptions.readCheckpoint(params))
  on('agent.subscriptions.activate', (params) => {
    const activation = subscriptions.activate(params)
    access.afterReply(activation.commit)
    return activation.result
  })
  on('agent.subscriptions.ack', (params) => subscriptions.ack(params))
  on('agent.subscriptions.close', ({ subscriptionId }) => {
    subscriptions.close(subscriptionId)
    return { closed: true as const }
  })
}
