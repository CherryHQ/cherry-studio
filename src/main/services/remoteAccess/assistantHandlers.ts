import { randomUUID } from 'node:crypto'

import { application } from '@application'
import type { RemoteFailure } from '@cherrystudio/remote-protocol'
import type { CommandReceipt } from '@cherrystudio/remote-protocol/agent'
import {
  assistantMethods,
  encodeAssistantCommand,
  type AssistantCursor,
  type AssistantEvent,
  type AssistantCheckpointPage,
  type AssistantMethod,
  type AssistantMutation,
  type AssistantParams,
  type AssistantResult
} from '@cherrystudio/remote-protocol/assistant'
import { RemoteRpcError, type RemoteRpcServer } from '@cherrystudio/remote-transport'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { messageService } from '@data/services/MessageService'
import { remoteCommandService, type RemoteCommandOutcome } from '@data/services/RemoteCommandService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'

import { sha256, sliceContent, utf8 } from './agentQueries'
import type { RemoteAssistantHub } from './assistantJournal'
import {
  assertAssistantSend,
  assertView,
  assistantRevision,
  branchMessages,
  getAssistant,
  getAssistantTopic,
  getBranchMessage,
  listAssistants,
  listAssistantTopics,
  listAssistantMessages,
  listAssistantParts,
  persistedAssistantInteractions,
  readAssistantContent,
  readAssistantFileContent,
  scopedPage
} from './assistantQueries'
import { RemoteSubscriptions, type SubscriptionBudget } from './RemoteSubscriptions'
import type { DeviceGrant, RemoteUploads, UploadOwner } from './RemoteUploads'

const logger = loggerService.withContext('RemoteAssistantHandlers')
export type AssistantSubscriptions = RemoteSubscriptions<AssistantCursor, AssistantCheckpointPage, AssistantEvent>
export function createAssistantSubscriptions(
  hub: RemoteAssistantHub,
  send: (notification: unknown) => Promise<void>,
  budget?: SubscriptionBudget
): AssistantSubscriptions {
  return new RemoteSubscriptions(
    hub,
    send,
    {
      namespace: 'assistant',
      resourceKey: 'topicId',
      resourceOf: (cursor) => cursor.topicId,
      cursor: (topicId, streamEpoch, seq) => ({ topicId, streamEpoch, seq })
    },
    budget
  )
}
interface AssistantAccess {
  requireAssistant(): DeviceGrant
  afterReply(fn: () => void): void
}

export function registerAssistantMethods(
  rpc: RemoteRpcServer<void>,
  access: AssistantAccess,
  hub: RemoteAssistantHub,
  subscriptions: AssistantSubscriptions,
  uploads: RemoteUploads
): void {
  type Auth = ReturnType<AssistantAccess['requireAssistant']>
  const requireGrant = (auth: Auth) => {
    const current = apiGatewayPairedDeviceService.getRemoteAuthorization(auth.deviceId, auth.peerIdentity)
    if (!current?.grants.some((grant) => grant.domain === 'assistant' && grant.grantId === auth.grantId))
      throw new RemoteRpcError('GRANT_REVOKED', 'Assistant authorization changed')
  }
  const assistantUploads = (auth: Auth): UploadOwner => ({ ...auth, domain: 'assistant' })
  const presence = application.get('AttachmentPresenceService')
  const generation = presence.connection()
  const on = <M extends AssistantMethod>(
    name: M,
    handler: (params: AssistantParams<M>, auth: Auth) => AssistantResult<M> | Promise<AssistantResult<M>>
  ) =>
    rpc.addMethod<AssistantParams<M>, AssistantResult<M>>(name, assistantMethods[name] as never, (params) =>
      Promise.resolve().then(() => handler(params, access.requireAssistant()))
    )
  const command = async <M extends AssistantMutation>(
    auth: Auth,
    method: M,
    params: AssistantParams<M>,
    run: () => Promise<RemoteCommandOutcome>
  ): Promise<CommandReceipt> => {
    const key = { ...auth, commandId: params.commandId }
    const admitted = remoteCommandService.admit(key, {
      method,
      identityDigest: sha256(encodeAssistantCommand(method, params)),
      ...('topicId' in params ? { topicId: params.topicId } : {})
    })
    if (admitted.kind === 'conflict')
      throw new RemoteRpcError('IDEMPOTENCY_CONFLICT', 'Command differs from its recorded input')
    if (admitted.kind === 'exhausted')
      throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Command receipt capacity reached')
    if (admitted.kind === 'existing') return admitted.receipt
    let outcome: RemoteCommandOutcome
    try {
      outcome = await run()
    } catch (error) {
      const prior = remoteCommandService.get(key)
      if (error instanceof RemoteRpcError)
        outcome = { status: prior?.executionId ? 'interrupted' : 'rejected', error: error.data as RemoteFailure }
      else {
        logger.warn('Assistant command interrupted before settling', { method, error })
        outcome = {
          status: 'interrupted',
          error: {
            reason: 'INTERNAL',
            message: 'Command outcome is uncertain; recover its receipt before sending another command'
          }
        }
      }
      const receipt = remoteCommandService.get(key)
      const result = receipt?.result as { messageId?: string } | undefined
      if (
        result?.messageId &&
        'topicId' in params &&
        !application.get('AiStreamManager').hasUnsettledTopicWork(params.topicId)
      ) {
        try {
          const message = messageService.getById(result.messageId)
          if (message.status === 'pending') messageService.markMessagesError([message.id])
        } catch (cleanupError) {
          logger.warn('Could not terminalize interrupted Assistant reservation', { cleanupError })
        }
      }
    }
    const reserved = remoteCommandService.get(key)?.result
    if (outcome.status === 'applied' && reserved && typeof reserved === 'object' && !Array.isArray(reserved)) {
      outcome = {
        ...outcome,
        result: { ...reserved, ...(outcome.result && typeof outcome.result === 'object' ? outcome.result : {}) }
      }
    }
    return remoteCommandService.settle(key, outcome)
  }

  on('assistant.assistants.list', (params, auth) => listAssistants(auth.grantId, params.cursor, params.limit))
  on('assistant.topics.list', (params, auth) =>
    listAssistantTopics(params, auth.grantId, (id) => hub.activeExecutionIds(id))
  )
  on('assistant.topics.get', ({ topicId }) => ({ topic: getAssistantTopic(topicId, hub.activeExecutionIds(topicId)) }))
  on('assistant.topics.create', async (params, auth) => {
    try {
      const admitted = remoteCommandService.apply(
        { ...auth, commandId: params.commandId },
        {
          method: 'assistant.topics.create',
          identityDigest: sha256(encodeAssistantCommand('assistant.topics.create', params))
        },
        (tx) => {
          requireGrant(auth)
          getAssistant(params.assistantId)
          const topic = topicService.createTx(tx, { assistantId: params.assistantId, name: params.title ?? '' })
          return { status: 'applied', topicId: topic.id, result: { topicId: topic.id } }
        }
      )
      if (admitted.kind === 'conflict')
        throw new RemoteRpcError('IDEMPOTENCY_CONFLICT', 'Command differs from its recorded input')
      if (admitted.kind === 'exhausted')
        throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Command receipt capacity reached')
      if (admitted.kind === 'accepted' && admitted.receipt.topicId)
        topicService.notifyReadModelChange([admitted.receipt.topicId], 'membership')
      return admitted.receipt
    } catch (error) {
      return command(auth, 'assistant.topics.create', params, async () => {
        throw error
      })
    }
  })
  on('assistant.attachments.present', (params, auth) => {
    getAssistantTopic(params.topicId)
    return presence.present(uploads.scope(assistantUploads(auth)), auth, generation, params)
  })
  on('assistant.messages.list', (params, auth) => listAssistantMessages(params, auth.grantId))
  on('assistant.parts.list', (params, auth) => listAssistantParts(params, auth.grantId))
  on('assistant.content.read', async (params) => {
    assertView(params)
    getBranchMessage(params.topicId, params.contentId.split(':')[0])
    const bytes =
      subscriptions.readContent(params.topicId, params.contentId, params.revision) ??
      hub.journal(params.topicId).readContent(params.contentId, params.revision) ??
      readAssistantContent(params)
    const file = !bytes?.length ? await readAssistantFileContent(params) : undefined
    if (file) {
      access.requireAssistant()
      return file
    }
    if (!bytes) throw new RemoteRpcError('NOT_FOUND', 'Content not available at this revision')
    return {
      contentId: params.contentId,
      revision: params.revision,
      ...sliceContent(bytes, params.offset, params.maxBytes)
    }
  })
  on('assistant.messages.send', (params, auth) =>
    command(auth, 'assistant.messages.send', params, async () => {
      const owner = assistantUploads(auth)
      const scope = uploads.scope(owner)
      presence.submitting(scope, params.selectionId, params.commandId)
      try {
        return await uploads.withFiles(owner, params.attachments ?? [], async (attachments) => {
          const journal = hub.journal(params.topicId)
          const manager = application.get('AiStreamManager')
          const executionId = randomUUID()
          let reservedView: ReturnType<typeof getAssistantTopic> | undefined
          let reservedHistory: string | undefined
          const fingerprint = () =>
            sha256(
              utf8(
                JSON.stringify(
                  branchMessages(params.topicId).map(({ id, parentId, data, status, modelId, messageSnapshot }) => ({
                    id,
                    parentId,
                    data,
                    status,
                    modelId,
                    messageSnapshot
                  }))
                )
              )
            )
          const beforePersist = () => {
            requireGrant(auth)
            if (manager.hasUnsettledTopicWork(params.topicId)) throw new RemoteRpcError('CONFLICT', 'Topic is busy')
            assertAssistantSend(params)
          }
          const result = await manager.dispatch(
            journal,
            {
              trigger: 'submit-message',
              topicId: params.topicId,
              targetMode: 'active-path',
              ...(params.parentAnchorId ? { parentAnchorId: params.parentAnchorId } : {}),
              userMessageParts: [
                ...(params.text.trim() ? [{ type: 'text' as const, text: params.text }] : []),
                ...attachments
              ]
            },
            {
              beforePersist,
              onPersist: (tx, reserved) => {
                const messageId = reserved.placeholders[0].id
                remoteCommandService.reserveExecutionTx(
                  tx,
                  { ...auth, commandId: params.commandId },
                  { executionId, messageId, userMessageId: reserved.userMessage.id }
                )
                journal.reserve(messageId, executionId)
                reservedView = getAssistantTopic(params.topicId)
                reservedHistory = fingerprint()
              },
              beforeActivate: () => {
                requireGrant(auth)
                const current = getAssistantTopic(params.topicId)
                if (
                  !reservedView ||
                  current.parentAnchorId !== reservedView.parentAnchorId ||
                  current.assistantId !== params.assistantId ||
                  fingerprint() !== reservedHistory ||
                  assistantRevision(getAssistant(params.assistantId)) !== params.expectedAssistantRevision
                )
                  throw new RemoteRpcError('CONFLICT', 'Topic changed while preparing the message')
              }
            }
          )
          if (result.mode === 'blocked')
            return { status: 'rejected', error: { reason: 'CONFLICT', message: 'Desktop execution is paused' } }
          journal.poll()
          return {
            status: 'applied',
            topicId: params.topicId,
            executionId,
            result: { executionId, disposition: 'started' }
          }
        })
      } finally {
        presence.submitting(scope, params.selectionId, params.commandId)
      }
    })
  )
  on('assistant.executions.cancel', (params, auth) =>
    command(auth, 'assistant.executions.cancel', params, async () => {
      const journal = hub.journal(params.topicId)
      await application.get('AiStreamManager').abortAndDrain(params.topicId, 'remote-cancel', () => {
        requireGrant(auth)
        const actual = journal.activeExecutionIds().sort()
        const expected = [...params.expectedExecutionIds].sort()
        if (!actual.length || JSON.stringify(actual) !== JSON.stringify(expected))
          throw new RemoteRpcError('CONFLICT', 'Active executions changed since they were read')
      })
      return {
        status: 'applied',
        topicId: params.topicId,
        result: { executionIds: params.expectedExecutionIds, disposition: 'cancelled' }
      }
    })
  )
  on('assistant.interactions.list', (params, auth) =>
    scopedPage(
      persistedAssistantInteractions(params.topicId),
      `${auth.grantId}:interactions:${params.topicId}:${getAssistantTopic(params.topicId).historyRevision}`,
      params.cursor,
      params.limit
    )
  )
  on('assistant.interactions.get', ({ topicId, interactionId }) => {
    const interaction = persistedAssistantInteractions(topicId).find((item) => item.interactionId === interactionId)
    if (!interaction) throw new RemoteRpcError('NOT_FOUND', 'Interaction not found on the current branch')
    return { interaction }
  })
  on('assistant.interactions.respond', (params, auth) =>
    command(auth, 'assistant.interactions.respond', params, async () => {
      const journal = hub.journal(params.topicId)
      const executionId = randomUUID()
      const result = await application.get('AiStreamManager').respondAssistantToolApproval(
        {
          topicId: params.topicId,
          anchorId: params.messageId,
          approvalId: params.interactionId,
          approved: params.decision === 'approve'
        },
        journal,
        {
          beforeDecision: () => {
            requireGrant(auth)
            const interaction = persistedAssistantInteractions(params.topicId).find(
              (item) => item.interactionId === params.interactionId
            )
            if (
              !interaction ||
              interaction.messageId !== params.messageId ||
              interaction.status !== 'pending' ||
              interaction.revision !== params.expectedRevision ||
              interaction.executionId !== params.expectedExecutionId ||
              interaction.configurationRevision !== params.expectedAssistantRevision ||
              interaction.inputDigest !== params.inputDigest
            )
              throw new RemoteRpcError('CONFLICT', 'Approval changed since it was read')
            if (!interaction.respondable || interaction.desktopRequired)
              throw new RemoteRpcError('TARGET_UNAVAILABLE', 'This interaction requires action on the desktop')
          },
          beforeContinue: () => {
            requireGrant(auth)
            const topic = getAssistantTopic(params.topicId)
            if (
              !topic.assistantId ||
              assistantRevision(getAssistant(topic.assistantId)) !== params.expectedAssistantRevision
            )
              throw new RemoteRpcError('CONFLICT', 'Assistant configuration changed during approval continuation')
          },
          onDecisionPersist: (tx) => {
            const anchor = getBranchMessage(params.topicId, params.messageId)
            remoteCommandService.reserveExecutionTx(
              tx,
              { ...auth, commandId: params.commandId },
              { executionId, messageId: params.messageId, userMessageId: anchor.parentId! }
            )
            journal.reserve(params.messageId, executionId)
          }
        }
      )
      if (!result.ok)
        return {
          status: 'rejected',
          error: { reason: 'CONFLICT', message: 'Approval cannot resume while the topic is busy or paused' }
        }
      journal.poll()
      const started = journal.activeExecutionIds().includes(executionId)
      return {
        status: 'applied',
        topicId: params.topicId,
        ...(started ? { executionId } : {}),
        result: {
          interactionId: params.interactionId,
          decision: params.decision,
          disposition: started ? 'continued' : 'decision-recorded'
        }
      }
    })
  )
  on('assistant.commands.get', ({ commandId }, auth) => {
    const receipt = remoteCommandService.get({ ...auth, commandId })
    if (!receipt || !receipt.method.startsWith('assistant.'))
      throw new RemoteRpcError('NOT_FOUND', 'Assistant command not found')
    return receipt
  })
  on('assistant.topics.subscribe', (params) =>
    subscriptions.subscribe({ resourceId: params.topicId, cursor: params.cursor })
  )
  on('assistant.checkpoints.read', (params) => subscriptions.readCheckpoint(params))
  on('assistant.subscriptions.activate', (params) => {
    const activation = subscriptions.activate(params)
    access.afterReply(activation.commit)
    return activation.result
  })
  on('assistant.subscriptions.ack', (params) => subscriptions.ack(params))
  on('assistant.subscriptions.close', ({ subscriptionId }) => {
    subscriptions.close(subscriptionId)
    return { closed: true }
  })
}
