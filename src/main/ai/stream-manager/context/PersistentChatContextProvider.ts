/**
 * PersistentChatContextProvider — the default provider for regular (SQLite-backed) topics.
 *
 * Responsibilities for a single `Ai_Stream_Open` request:
 *  - read the topic + assistant + model from SQLite
 *  - persist the user message (or resolve it when regenerating)
 *  - create one `pending` assistant placeholder per execution
 *  - build the conversation history from the tree path
 *  - assemble per-execution PersistenceListeners
 *
 * This provider intentionally handles "any topicId that isn't claimed by another provider".
 * Keep it last in the dispatcher providers array (see `./dispatch.ts`).
 */

import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { messageService } from '@main/data/services/MessageService'
import { topicNamingService } from '@main/services/TopicNamingService'
import type { AiStreamOpenRequest } from '@shared/ai/transport'
import type { Message } from '@shared/data/types/message'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import type { AiStreamRequest } from '../../AiService'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { MessageServiceBackend } from '../persistence/backends/MessageServiceBackend'
import type { CherryUIMessage, StreamListener } from '../types'
import type { ChatContextProvider, PreparedDispatch } from './ChatContextProvider'
import { resolveModels, resolvePersistentSiblingsGroupId } from './modelResolution'

const logger = loggerService.withContext('PersistentChatContextProvider')

export class PersistentChatContextProvider implements ChatContextProvider {
  readonly name = 'persistent'

  /** Default provider — matches any topic not claimed by a more specific provider. */
  canHandle(): boolean {
    return true
  }

  async prepareDispatch(subscriber: StreamListener, req: AiStreamOpenRequest): Promise<PreparedDispatch> {
    // 1. Resolve context
    const topic = await topicService.getById(req.topicId)
    const assistantId = topic?.assistantId
    if (!assistantId) throw new Error(`Cannot resolve assistantId for topic ${req.topicId}`)

    const assistant = await assistantDataService.getById(assistantId)
    if (!assistant.modelId) throw new Error(`Assistant ${assistantId} has no model configured`)

    const defaultModelId = assistant.modelId

    // 2. User message
    const isRegenerate = req.trigger === 'regenerate-message'
    const userMessage = isRegenerate
      ? await messageService.getById(req.parentAnchorId ?? '')
      : await messageService.create(req.topicId, {
          role: 'user',
          parentId: req.parentAnchorId,
          data: { parts: req.userMessageParts },
          status: 'success',
          modelId: defaultModelId,
          modelSnapshot: (() => {
            const { providerId, modelId: rawModelId } = parseUniqueModelId(defaultModelId)
            return { id: rawModelId, name: rawModelId, provider: providerId }
          })()
        })

    const shouldAutoNameInitialTurn = !isRegenerate && !req.parentAnchorId
    if (shouldAutoNameInitialTurn) {
      void topicNamingService.maybeRenameFromFirstUserMessage(req.topicId, userMessage.id)
    }

    // 3. Models (single or multi)
    const models = await resolveModels(req.mentionedModelIds, defaultModelId)
    const isMultiModel = models.length > 1

    // 4. Siblings group. Snapshot the pre-existing groupId so we can roll the
    //    backfill back if the reservation below fails.
    const siblingsGroupIdBefore = await this.readExistingGroupId(isRegenerate, userMessage.id)
    const siblingsGroupId = await resolvePersistentSiblingsGroupId(models, isRegenerate, userMessage.id)

    // 5. Create one assistant placeholder per execution before streaming
    //    starts. We use `allSettled` + a manual failure check so that on
    //    partial failure we can compensate by deleting any placeholders that
    //    DID land (plus the fresh user message and a newly-allocated siblings
    //    group backfill), instead of leaving orphans stuck in `pending`.
    const settled = await Promise.allSettled(
      models.map(async (model) => {
        const placeholder = await messageService.create(req.topicId, {
          role: 'assistant',
          parentId: userMessage.id,
          data: { parts: [] },
          status: 'pending',
          modelId: model.id,
          modelSnapshot: {
            id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
            name: model.name,
            provider: model.providerId
          },
          siblingsGroupId,
          // TODO: replace with traceId from request after v2 refactor
          traceId: crypto.randomUUID()
        })

        return { model, placeholder }
      })
    )

    const created = settled
      .filter((r): r is PromiseFulfilledResult<{ model: Model; placeholder: Message }> => r.status === 'fulfilled')
      .map((r) => r.value)
    const failure = settled.find((r) => r.status === 'rejected')
    if (failure) {
      await this.rollbackReservation({
        createdPlaceholders: created,
        siblingsGroupIdBefore,
        siblingsGroupIdAfter: siblingsGroupId,
        userMessage,
        isRegenerate
      })
      throw failure.reason
    }

    const assistantPlaceholders = created

    // 6. Build listeners: 1 subscriber + N persistence listeners (one per model).
    //    Each listener wraps a MessageServiceBackend that finalizes a single
    //    placeholder. Auto-rename (the only afterPersist hook today) is attached
    //    to *one* backend so it fires exactly once even in multi-model turns.
    const listeners: StreamListener[] = [subscriber]
    for (let i = 0; i < assistantPlaceholders.length; i++) {
      const { model, placeholder } = assistantPlaceholders[i]
      const attachAutoRename = shouldAutoNameInitialTurn && i === 0
      listeners.push(
        new PersistenceListener({
          topicId: req.topicId,
          modelId: model.id,
          backend: new MessageServiceBackend({
            assistantMessageId: placeholder.id,
            modelSnapshot: {
              id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
              name: model.name,
              provider: model.providerId
            },
            afterPersist: attachAutoRename
              ? async (finalMessage) => {
                  await topicNamingService.maybeRenameFromConversationSummary(
                    req.topicId,
                    assistantId,
                    userMessage.id,
                    finalMessage
                  )
                }
              : undefined
          })
        })
      )
    }

    // 7. Build per-model requests. The dispatcher runs `manager.send` itself.
    const history = await this.buildHistory(userMessage.id)
    const models_ = assistantPlaceholders.map(({ model, placeholder }) => ({
      modelId: model.id,
      request: this.buildStreamRequest(req.topicId, assistantId, model.id, history, placeholder.id)
    }))

    return {
      topicId: req.topicId,
      models: models_,
      listeners,
      siblingsGroupId,
      isMultiModel
    }
  }

  /**
   * Read conversation history along the active path from root → user message.
   * Pulled out of AiStreamManager so the registry stays free of data-layer dependencies.
   */
  private async buildHistory(userMessageId: string): Promise<CherryUIMessage[]> {
    const messagePath = await messageService.getPathToNode(userMessageId)
    return messagePath.map((msg) => ({
      id: msg.id,
      role: msg.role as CherryUIMessage['role'],
      parts: msg.data.parts ?? []
    }))
  }

  private buildStreamRequest(
    topicId: string,
    assistantId: string,
    uniqueModelId: UniqueModelId,
    history: CherryUIMessage[],
    messageId: string
  ): AiStreamRequest {
    return {
      chatId: topicId,
      trigger: 'submit-message',
      assistantId,
      uniqueModelId,
      messages: history,
      messageId
    }
  }
  /**
   * Snapshot the existing siblings group (if any) on the parent before
   * `resolvePersistentSiblingsGroupId` backfills children. We only roll
   * back the backfill when we *newly allocated* the group — callers that
   * inherited an existing group must not revert its children.
   */
  private async readExistingGroupId(isRegenerate: boolean, userMessageId: string): Promise<number | undefined> {
    if (!isRegenerate) return undefined
    const children = await messageService.getChildrenByParentId(userMessageId)
    return children.find((m) => m.siblingsGroupId > 0)?.siblingsGroupId
  }

  /**
   * Delete any placeholders + user message created during the reservation
   * phase and revert a newly-allocated `siblingsGroupId`. Errors from the
   * cleanup itself are logged but never rethrown — the original failure
   * reason is what the caller cares about.
   */
  private async rollbackReservation(opts: {
    createdPlaceholders: Array<{ model: Model; placeholder: Message }>
    siblingsGroupIdBefore: number | undefined
    siblingsGroupIdAfter: number | undefined
    userMessage: Message
    isRegenerate: boolean
  }): Promise<void> {
    // 1. Remove any placeholders that did land so the UI is not stuck on
    //    "pending" forever.
    for (const { placeholder } of opts.createdPlaceholders) {
      try {
        await messageService.delete(placeholder.id)
      } catch (err) {
        logger.warn('rollback: failed to delete orphan placeholder', { placeholderId: placeholder.id, err })
      }
    }

    // 2. If we newly allocated a siblingsGroupId AND some existing sibling's
    //    groupId was backfilled by `resolvePersistentSiblingsGroupId`, revert
    //    them to 0. We only touch siblings whose current groupId matches the
    //    just-allocated id (conservative: leaves siblings already in other
    //    groups alone) and skip the placeholders we already deleted.
    if (
      opts.isRegenerate &&
      opts.siblingsGroupIdAfter != null &&
      opts.siblingsGroupIdAfter !== opts.siblingsGroupIdBefore
    ) {
      try {
        const children = await messageService.getChildrenByParentId(opts.userMessage.id)
        const createdIds = new Set(opts.createdPlaceholders.map((p) => p.placeholder.id))
        for (const child of children) {
          if (child.siblingsGroupId === opts.siblingsGroupIdAfter && !createdIds.has(child.id)) {
            await messageService.updateSiblingsGroupId(child.id, opts.siblingsGroupIdBefore ?? 0)
          }
        }
      } catch (err) {
        logger.warn('rollback: failed to revert siblingsGroupId backfill', { err })
      }
    }

    // 3. If this was a fresh turn (non-regenerate) we also created the user
    //    message; delete it so the tree doesn't retain a dangling user turn
    //    with no assistant reply.
    if (!opts.isRegenerate) {
      try {
        await messageService.delete(opts.userMessage.id)
      } catch (err) {
        logger.warn('rollback: failed to delete user message', {
          userMessageId: opts.userMessage.id,
          err
        })
      }
    }
  }
}

export const persistentChatContextProvider = new PersistentChatContextProvider()
