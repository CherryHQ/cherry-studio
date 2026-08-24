import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import {
  ConversationActiveNodeMove,
  ConversationAdmissionReason,
  ConversationContinuationTrigger,
  ConversationKind,
  ConversationOpenTrigger,
  ConversationOutcomeKind,
  type ConversationRef,
  ConversationTargetMode
} from '@shared/ai/conversation'
import { createUniqueModelId } from '@shared/data/types/model'
import { getKnowledgeBaseIdsFromParts } from '@shared/data/types/uiParts'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '../../types'
import { ConversationInteractionCommitResultKind } from '../ConversationHistoryPort'
import type { MainDispatchRequest, MainSteerContinuationRequest } from '../dispatch'
import { resolveAssistantModelId, resolveModels, resolvePersistentSiblingsGroupId } from '../modelResolution'
import { assertPureCommittedIntent } from './assertPureCommittedIntent'

// Stub model resolution + tracing so the test drives the REAL DB history path
// (`createUserMessageWithPlaceholders` → `getPathToNode`) without provider/model
// resolution machinery. The history is what we assert on.
const MODEL_ID = createUniqueModelId('openai', 'gpt-4o')
vi.mock('../modelResolution', () => ({
  resolveAssistantModelId: vi.fn(() => ({ assistantId: undefined, defaultModelId: MODEL_ID })),
  resolveModels: vi.fn(() => [{ id: MODEL_ID, name: 'GPT-4o', providerId: 'openai', apiModelId: 'gpt-4o' }]),
  resolvePersistentSiblingsGroupId: vi.fn(() => 1)
}))

vi.mock('../../../observability', async (importOriginal) => ({
  ...(await importOriginal()),
  startAiChildTurnSpan: vi.fn(() => ({ rootSpan: { end: vi.fn() }, traceId: 'trace-1' })),
  deriveRootSpanId: vi.fn(() => '1'.repeat(16)),
  applyTurnInputAttributes: vi.fn()
}))

const { PersistentChatContextProvider } = await import('../PersistentChatContextProvider')

class PersistentChatHistoryHarness extends PersistentChatContextProvider {
  async prepareDispatch(
    _subscriber: StreamListener,
    request: MainDispatchRequest,
    context: { hasLiveStream: boolean }
  ) {
    const signal = new AbortController().signal
    const validation = await this.validateIntent(request, context, signal)
    const committed = this.commitIntent(validation, context)
    assertPureCommittedIntent(committed)
    const execution = await this.prepareExecutionContext(committed.executions[0].preparation, signal)
    return {
      ...execution,
      executions: committed.executions,
      reservedMessages: committed.reservedMessages,
      siblingsGroupId: committed.executions[0]
        ? messageService.getById(committed.executions[0].outputNodeId).siblingsGroupId || undefined
        : undefined,
      activeNodeDecision: committed.activeNodeDecision
    }
  }
}

const conversation: ConversationRef = { kind: ConversationKind.Chat, id: 'topic-1' }

function makeSubscriber(): StreamListener {
  return { id: 'wc:1', onChunk: vi.fn(), onDone: vi.fn(), onPaused: vi.fn(), onError: vi.fn(), isAlive: () => true }
}

/** Flatten a history message to `{ role, text }` for order-sensitive assertions. */
function flatten(messages: { role: string; parts: Array<{ type: string; text?: string }> }[]) {
  return messages.map((m) => ({
    role: m.role,
    text: m.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('')
  }))
}

describe('PersistentChatContextProvider — steer continuation history', () => {
  const dbh = setupTestDatabase()
  const provider = new PersistentChatHistoryHarness()

  // The text a prior turn produced before it yielded to the steer; the steer continuation's
  // history must include it (it was persisted on the assistant row by the normal terminal path).
  const PARTIAL = 'partial answer so far'

  beforeEach(async () => {
    const [providerKey, modelKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: providerKey })
    await dbh.db.insert(userModelTable).values({
      id: MODEL_ID,
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: 'GPT-4o',
      isEnabled: true,
      isHidden: false,
      orderKey: modelKey
    })

    await dbh.db.insert(topicTable).values({ id: 'topic-1', activeNodeId: 'a1', orderKey: 'a0' })
    await dbh.db.insert(messageTable).values(
      withRoot('topic-1', [
        {
          id: 'u1',
          parentId: null,
          topicId: 'topic-1',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'first question' }] },
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          id: 'a1',
          parentId: 'u1',
          topicId: 'topic-1',
          role: 'assistant',
          data: { parts: [{ type: 'text', text: PARTIAL }] },
          status: 'paused',
          siblingsGroupId: 1,
          modelId: MODEL_ID,
          createdAt: 200,
          updatedAt: 200
        }
      ])
    )
  })

  it('returns the authoritative Chat outputs repaired during boot recovery', async () => {
    await dbh.db.insert(messageTable).values({
      id: 'a2',
      parentId: 'a1',
      topicId: 'topic-1',
      role: 'assistant',
      data: {
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'tool-1',
            toolName: 'Read',
            state: 'input-available',
            input: { path: '/tmp/input.txt' }
          }
        ]
      },
      status: 'pending',
      siblingsGroupId: 2,
      modelId: MODEL_ID,
      createdAt: 300,
      updatedAt: 300
    })

    expect(provider.recoverCrashOrphans()).toEqual({
      repairedOutputs: [{ outputNodeId: 'a2', status: 'error' }]
    })
    expect(messageService.getById('a2')).toMatchObject({
      status: 'error',
      data: { parts: [expect.objectContaining({ state: 'output-error' })] }
    })
  })

  it('rebuilds a prompt that carries the paused partial when the new turn anchors on the paused row', async () => {
    // Steering: renderer's `activeNodeId` (the streaming/paused assistant row) is sent as
    // `parentAnchorId`, so the new user message is parented on the paused row.
    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation,
        parentAnchorId: 'a1',
        userMessageParts: [{ type: 'text', text: 'actually, change direction' }]
      },
      { hasLiveStream: false }
    )

    const history = prepared.models[0].request.messages
    expect(provider.isPersistentConversation).toBe(true)
    expect(history).toBeDefined()
    expect(flatten(history!)).toEqual([
      { role: 'user', text: 'first question' },
      // The paused partial survives into the rebuilt prompt — this is the B4 efficacy guarantee.
      { role: 'assistant', text: PARTIAL },
      { role: 'user', text: 'actually, change direction' }
    ])
  })

  it('throws on duplicate modelId within a single send call', async () => {
    const childrenBefore = messageService.getChildrenByParentId('a1')

    await expect(
      provider.prepareDispatch(
        makeSubscriber(),
        {
          trigger: ConversationOpenTrigger.SubmitMessage,
          conversation,
          parentAnchorId: 'a1',
          userMessageParts: [{ type: 'text', text: 'compare twice' }],
          mentionedModelIds: [MODEL_ID, MODEL_ID]
        },
        { hasLiveStream: false }
      )
    ).rejects.toThrow('mentionedModelIds must not contain duplicate model ids')

    expect(messageService.getChildrenByParentId('a1')).toEqual(childrenBefore)
  })

  it('commits an error-capable assistant skeleton when a queued steer can no longer validate', async () => {
    const steer = messageService.create('topic-1', {
      role: 'user',
      parentId: 'a1',
      data: { parts: [{ type: 'text', text: 'queued follow-up' }] },
      status: 'success',
      modelId: MODEL_ID
    })
    const serialized = { name: 'Error', message: 'model removed', stack: null }
    const failure = provider.validateInputFailure(
      {
        trigger: ConversationContinuationTrigger.ContinueSteer,
        conversation,
        userMessageId: steer.id,
        fastMode: false
      },
      serialized
    )
    if (!failure) throw new Error('failed steer did not validate its terminal fallback')
    const committed = provider.commitInputFailureIntent(failure)

    expect(committed.executions).toEqual([
      expect.objectContaining({ modelId: MODEL_ID, outputNodeId: expect.any(String) })
    ])
    const execution = committed.executions[0]
    await expect(provider.prepareExecutionContext(execution.preparation, new AbortController().signal)).rejects.toThrow(
      'model removed'
    )

    const outputNodeId = execution.outputNodeId
    await provider.persistTerminal(execution.persistence, {
      status: ConversationOutcomeKind.Error,
      error: serialized,
      modelId: MODEL_ID,
      anchorMessageId: outputNodeId
    })
    expect(messageService.getById(outputNodeId)).toMatchObject({ status: 'error' })
  })

  it('fills a reserved branch and creates its assistant placeholder when the topic is idle', async () => {
    const reservedBranch = messageService.reserveBranch('a1', false)

    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation,
        parentAnchorId: reservedBranch.id,
        userMessageParts: [{ type: 'text', text: 'continue on reserved branch' }],
        targetMode: ConversationTargetMode.ReservedBranch
      },
      { hasLiveStream: false }
    )

    expect(prepared.reservedMessages?.find((message) => message.role === 'user')?.id).toBe(reservedBranch.id)
    expect(messageService.getById(reservedBranch.id)).toMatchObject({
      data: { parts: [{ type: 'text', text: 'continue on reserved branch' }] },
      modelId: MODEL_ID
    })
    expect(messageService.getChildrenByParentId(reservedBranch.id)).toHaveLength(1)
    expect(flatten(prepared.models[0].request.messages!)).toEqual([
      { role: 'user', text: 'first question' },
      { role: 'assistant', text: PARTIAL },
      { role: 'user', text: 'continue on reserved branch' }
    ])
  })

  it('rejects a reserved-branch submit during a live stream without changing the reservation', async () => {
    const reservedBranch = messageService.reserveBranch('a1', false)

    await expect(
      provider.prepareDispatch(
        makeSubscriber(),
        {
          trigger: ConversationOpenTrigger.SubmitMessage,
          conversation,
          parentAnchorId: reservedBranch.id,
          userMessageParts: [{ type: 'text', text: 'wait for the current turn' }],
          targetMode: ConversationTargetMode.ReservedBranch
        },
        { hasLiveStream: true }
      )
    ).rejects.toThrow('Cannot submit a reserved branch while a stream is live on this topic')

    expect(messageService.getById(reservedBranch.id).data).toEqual({ parts: [] })
    expect(messageService.getChildrenByParentId(reservedBranch.id)).toEqual([])
  })

  it('does not degrade stale reserved intent into a steer after the node has already been filled', async () => {
    const reservedBranch = messageService.reserveBranch('a1', false)
    messageService.update(reservedBranch.id, { data: { parts: [{ type: 'text', text: 'already filled' }] } })

    await expect(
      provider.prepareDispatch(
        makeSubscriber(),
        {
          trigger: ConversationOpenTrigger.SubmitMessage,
          conversation,
          parentAnchorId: reservedBranch.id,
          userMessageParts: [{ type: 'text', text: 'duplicate send' }],
          targetMode: ConversationTargetMode.ReservedBranch
        },
        { hasLiveStream: true }
      )
    ).rejects.toThrow('Cannot submit a reserved branch while a stream is live on this topic')

    expect(messageService.getById(reservedBranch.id).data.parts).toEqual([{ type: 'text', text: 'already filled' }])
    expect(messageService.getChildrenByParentId(reservedBranch.id)).toEqual([])
  })

  it('sends only messages after the latest clear marker on the selected branch', async () => {
    await dbh.db.insert(messageTable).values([
      {
        id: 'clear-1',
        parentId: 'a1',
        topicId: 'topic-1',
        role: 'user',
        data: { parts: [{ type: 'data-clear', data: {} }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: 'u2',
        parentId: 'clear-1',
        topicId: 'topic-1',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'after boundary' }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 400,
        updatedAt: 400
      },
      {
        id: 'clear-2',
        parentId: 'u2',
        topicId: 'topic-1',
        role: 'user',
        data: { parts: [{ type: 'data-clear', data: {} }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 500,
        updatedAt: 500
      },
      {
        id: 'u3',
        parentId: 'clear-2',
        topicId: 'topic-1',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'after latest boundary' }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 600,
        updatedAt: 600
      }
    ])

    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation,
        parentAnchorId: 'u3',
        userMessageParts: [{ type: 'text', text: 'new question' }]
      },
      { hasLiveStream: false }
    )

    expect(flatten(prepared.models[0].request.messages!)).toEqual([
      { role: 'user', text: 'after latest boundary' },
      { role: 'user', text: 'new question' }
    ])
  })

  it('keeps the full history when the selected branch does not pass through a clear marker', async () => {
    await dbh.db.insert(messageTable).values([
      {
        id: 'clear-other-branch',
        parentId: 'a1',
        topicId: 'topic-1',
        role: 'user',
        data: { parts: [{ type: 'data-clear', data: {} }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: 'u-old-branch',
        parentId: 'a1',
        topicId: 'topic-1',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'branch without boundary' }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 400,
        updatedAt: 400
      }
    ])

    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation,
        parentAnchorId: 'u-old-branch',
        userMessageParts: [{ type: 'text', text: 'continue old branch' }]
      },
      { hasLiveStream: false }
    )

    expect(flatten(prepared.models[0].request.messages!)).toEqual([
      { role: 'user', text: 'first question' },
      { role: 'assistant', text: PARTIAL },
      { role: 'user', text: 'branch without boundary' },
      { role: 'user', text: 'continue old branch' }
    ])
  })

  it('restores the composer-selected knowledge bases when regenerating a response', async () => {
    const knowledgeBaseIds = ['kb-selected-this-turn']
    const submitted = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation,
        parentAnchorId: 'a1',
        userMessageParts: [
          { type: 'text', text: 'search my selected knowledge base' },
          { type: 'data-knowledge-scope', data: { baseIds: knowledgeBaseIds } }
        ]
      },
      { hasLiveStream: false }
    )
    const userMessageId = submitted.reservedMessages?.find((message) => message.role === 'user')?.id as string

    expect(getKnowledgeBaseIdsFromParts(messageService.getById(userMessageId).data.parts ?? [])).toEqual(
      knowledgeBaseIds
    )

    const regenerated = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.RegenerateMessage,
        conversation,
        parentAnchorId: userMessageId
      },
      { hasLiveStream: false }
    )

    expect(regenerated.models[0].request.knowledgeBaseIds).toEqual(knowledgeBaseIds)
  })

  it('steer-continuation: opens an assistant turn under the steer user row with a reminder-wrapped prompt', async () => {
    // u1 → a1 → u2, where u2 is the steer the user sent mid-turn (child of the assistant row).
    await dbh.db.insert(messageTable).values({
      id: 'u2',
      parentId: 'a1',
      topicId: 'topic-1',
      role: 'user',
      data: {
        parts: [
          { type: 'text', text: 'actually do X instead' },
          { type: 'data-knowledge-scope', data: { baseIds: ['kb-selected-for-steer'] } }
        ]
      },
      status: 'success',
      siblingsGroupId: 0,
      modelId: MODEL_ID,
      createdAt: 300,
      updatedAt: 300
    })

    vi.mocked(resolveAssistantModelId).mockClear()
    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationContinuationTrigger.ContinueSteer,
        conversation,
        userMessageId: 'u2',
        serviceTier: 'flex',
        fastMode: false
      } satisfies MainSteerContinuationRequest,
      { hasLiveStream: false }
    )

    expect(resolveAssistantModelId).not.toHaveBeenCalled()
    expect(resolveModels).toHaveBeenLastCalledWith([MODEL_ID], MODEL_ID)
    expect(prepared.models[0].request.knowledgeBaseIds).toEqual(['kb-selected-for-steer'])
    expect(prepared.models[0].request.serviceTier).toBe('flex')

    // A fresh assistant placeholder is created under u2 — no new user row.
    const children = messageService.getChildrenByParentId('u2')
    expect(children).toHaveLength(1)
    expect(children[0]).toMatchObject({ role: 'assistant', status: 'pending' })

    // The persisted steer row is untouched (only the model-facing copy is wrapped).
    const u2 = messageService.getById('u2')
    expect(flatten([{ role: 'user', parts: u2.data.parts ?? [] }])[0].text).toBe('actually do X instead')

    // History is the full path; only the trailing steer message is system-reminder wrapped.
    const history = prepared.models[0].request.messages!
    expect(history).toHaveLength(3)
    expect(flatten([history[0]])[0]).toEqual({ role: 'user', text: 'first question' })
    expect(flatten([history[1]])[0]).toEqual({ role: 'assistant', text: PARTIAL })
    const lastText = flatten([history[2]])[0].text
    expect(history[2].role).toBe('user')
    expect(lastText).toContain('<system-reminder>')
    expect(lastText).toContain('actually do X instead')
    expect(lastText).toContain('Please address this message and continue with your tasks.')
  })

  it('drops the paused partial when the new turn does not anchor on it (precondition is necessary)', async () => {
    // Counter-case: anchoring on the prior user message (not the paused assistant row) rebuilds
    // a prompt WITHOUT the partial — proving the efficacy hinges on `parentAnchorId` = paused row.
    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation,
        parentAnchorId: 'u1',
        userMessageParts: [{ type: 'text', text: 'retry from before' }]
      },
      { hasLiveStream: false }
    )

    expect(flatten(prepared.models[0].request.messages!)).toEqual([
      { role: 'user', text: 'first question' },
      { role: 'user', text: 'retry from before' }
    ])
  })

  it('uses an explicit assistant-less model without reading the default preference', async () => {
    const selectedModelId = createUniqueModelId('anthropic', 'claude-sonnet-4-5')
    const [providerKey, modelKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'Anthropic', orderKey: providerKey })
    await dbh.db.insert(userModelTable).values({
      id: selectedModelId,
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      presetModelId: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      isEnabled: true,
      isHidden: false,
      orderKey: modelKey
    })
    vi.mocked(resolveAssistantModelId).mockClear()
    vi.mocked(resolveModels).mockReturnValueOnce([
      {
        id: selectedModelId,
        name: 'Claude Sonnet 4.5',
        providerId: 'anthropic',
        apiModelId: 'claude-sonnet-4-5'
      }
    ] as ReturnType<typeof resolveModels>)

    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation,
        parentAnchorId: 'u1',
        mentionedModelIds: [selectedModelId],
        userMessageParts: [{ type: 'text', text: 'use the selected model' }]
      },
      { hasLiveStream: false }
    )

    expect(resolveAssistantModelId).not.toHaveBeenCalled()
    expect(resolveModels).toHaveBeenLastCalledWith([selectedModelId], selectedModelId)
    expect(prepared.models[0].modelId).toBe(selectedModelId)
    const userMessageId = prepared.reservedMessages?.find((message) => message.role === 'user')?.id as string
    expect(messageService.getById(userMessageId).modelId).toBe(selectedModelId)
    expect(messageService.getChildrenByParentId(userMessageId)[0].modelId).toBe(selectedModelId)
  })

  it('fans out @-mentioned siblings: shared siblingsGroupId, one placeholder per model, aligned placeholders[i]/turnRootSpans[i]', async () => {
    // Two @-mentioned models → two assistant placeholders sharing one siblings group.
    // All placeholders share the container traceId now; assert the per-model row and span
    // line up by index (keyed on modelId) so a fan-out never crosses streams.
    const MODEL_A = createUniqueModelId('openai', 'gpt-4o') // already seeded in beforeEach
    const MODEL_B = createUniqueModelId('anthropic', 'claude-sonnet-4-5')
    // Placeholder rows FK to user_model(id) — seed the second @-mentioned model.
    const [bProviderKey, bModelKey] = generateOrderKeySequence(2)
    await dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'anthropic', name: 'Anthropic', orderKey: bProviderKey })
    await dbh.db.insert(userModelTable).values({
      id: MODEL_B,
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      presetModelId: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      isEnabled: true,
      isHidden: false,
      orderKey: bModelKey
    })
    vi.mocked(resolveModels).mockReturnValueOnce([
      { id: MODEL_A, name: 'GPT-4o', providerId: 'openai', apiModelId: 'gpt-4o' },
      { id: MODEL_B, name: 'Claude Sonnet 4.5', providerId: 'anthropic', apiModelId: 'claude-sonnet-4-5' }
    ] as ReturnType<typeof resolveModels>)
    vi.mocked(resolvePersistentSiblingsGroupId).mockReturnValueOnce(42)
    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation,
        parentAnchorId: 'u1',
        mentionedModelIds: [MODEL_A, MODEL_B],
        userMessageParts: [{ type: 'text', text: 'ask both models' }]
      },
      { hasLiveStream: false }
    )

    // Shared sibling group.
    expect(prepared.siblingsGroupId).toBe(42)

    // One execution per model, in mention order, each carrying only pure resource descriptors.
    expect(prepared.models.map((m) => m.modelId)).toEqual([MODEL_A, MODEL_B])
    expect(prepared.executions.map(({ modelId }) => modelId)).toEqual([MODEL_A, MODEL_B])

    // One persisted placeholder per model, both in the shared group, each routed to its
    // own request — placeholders[i]/turnRootSpans[i] alignment proven via per-row modelId.
    const userMessageId = prepared.reservedMessages?.find((message) => message.role === 'user')?.id as string
    const placeholders = messageService.getChildrenByParentId(userMessageId)
    expect(placeholders).toHaveLength(2)
    const byModel = new Map(placeholders.map((p) => [p.modelId, p]))
    const phA = byModel.get(MODEL_A)
    const phB = byModel.get(MODEL_B)
    expect(phA?.modelId).toBe(MODEL_A)
    expect(phB?.modelId).toBe(MODEL_B)
    expect(phA?.siblingsGroupId).toBe(42)
    expect(phB?.siblingsGroupId).toBe(42)
    expect(prepared.models[0].request.messageId).toBe(phA?.id)
    expect(prepared.models[1].request.messageId).toBe(phB?.id)

    expect(prepared.executions.map(({ persistence }) => persistence)).toEqual([
      expect.objectContaining({ modelId: MODEL_A, assistantMessageId: phA?.id }),
      expect.objectContaining({ modelId: MODEL_B, assistantMessageId: phB?.id })
    ])

    // History commits describe telemetry without opening spans or creating resource callbacks.
    const containerTraceId = topicService.ensureTraceId('topic-1')
    expect(prepared.executions.map(({ telemetry }) => telemetry?.traceId)).toEqual([containerTraceId, containerTraceId])
  })

  it('appends a new model execution after the existing live group without replacing its members', async () => {
    const appendedModelId = createUniqueModelId('anthropic', 'claude-sonnet-4-5')
    const settledSiblingModelId = createUniqueModelId('openai', 'gpt-4.1')
    const [providerKey, modelKey, settledSiblingModelKey] = generateOrderKeySequence(3)
    await dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'Anthropic', orderKey: providerKey })
    await dbh.db.insert(userModelTable).values([
      {
        id: appendedModelId,
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        presetModelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        isEnabled: true,
        isHidden: false,
        orderKey: modelKey
      },
      {
        id: settledSiblingModelId,
        providerId: 'openai',
        modelId: 'gpt-4.1',
        presetModelId: 'gpt-4.1',
        name: 'GPT-4.1',
        isEnabled: true,
        isHidden: false,
        orderKey: settledSiblingModelKey
      }
    ])
    vi.mocked(resolveModels).mockReturnValueOnce([
      {
        id: appendedModelId,
        name: 'Claude Sonnet 4.5',
        providerId: 'anthropic',
        apiModelId: 'claude-sonnet-4-5'
      }
    ] as ReturnType<typeof resolveModels>)
    vi.mocked(resolvePersistentSiblingsGroupId).mockReturnValueOnce(1)
    await dbh.db.insert(messageTable).values({
      id: 'a2',
      parentId: 'u1',
      topicId: 'topic-1',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'settled sibling' }] },
      status: 'success',
      siblingsGroupId: 1,
      modelId: settledSiblingModelId,
      createdAt: 250,
      updatedAt: 250
    })
    const userSelectedBranch = messageService.reserveBranch('a2', true)
    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.RegenerateMessage,
        conversation,
        parentAnchorId: 'u1',
        appendToLiveGroupMessageId: 'a2',
        mentionedModelIds: [appendedModelId]
      },
      { hasLiveStream: true }
    )

    const children = messageService.getChildrenByParentId('u1')
    const appended = children.find((message) => message.modelId === appendedModelId)
    expect(appended).toMatchObject({ parentId: 'u1', status: 'pending', siblingsGroupId: 1 })
    expect(prepared).toMatchObject({
      activeNodeDecision: { move: ConversationActiveNodeMove.Keep },
      siblingsGroupId: 1
    })
    expect(prepared.models[0].request.messageId).toBe(appended?.id)
    expect(messageService.getById(userSelectedBranch.id).parentId).toBe('a2')
    expect(topicService.getById('topic-1')?.activeNodeId).toBe(userSelectedBranch.id)
  })

  it('accepts the exact live anchor after its persisted sibling group is backfilled', async () => {
    const appendedModelId = createUniqueModelId('anthropic', 'claude-sonnet-4-5')
    const [providerKey, modelKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'Anthropic', orderKey: providerKey })
    await dbh.db.insert(userModelTable).values({
      id: appendedModelId,
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      presetModelId: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      isEnabled: true,
      isHidden: false,
      orderKey: modelKey
    })
    messageService.updateSiblingsGroupId('a1', 0)
    vi.mocked(resolveModels).mockReturnValueOnce([
      {
        id: appendedModelId,
        name: 'Claude Sonnet 4.5',
        providerId: 'anthropic',
        apiModelId: 'claude-sonnet-4-5'
      }
    ] as ReturnType<typeof resolveModels>)
    vi.mocked(resolvePersistentSiblingsGroupId).mockReturnValueOnce(7)

    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationOpenTrigger.RegenerateMessage,
        conversation,
        parentAnchorId: 'u1',
        appendToLiveGroupMessageId: 'a1',
        mentionedModelIds: [appendedModelId]
      },
      { hasLiveStream: true }
    )

    const children = messageService.getChildrenByParentId('u1')
    expect(children.find(({ id }) => id === 'a1')?.siblingsGroupId).toBe(7)
    expect(children.find(({ modelId }) => modelId === appendedModelId)).toMatchObject({
      status: 'pending',
      siblingsGroupId: 7
    })
    expect(prepared).toMatchObject({
      activeNodeDecision: { move: ConversationActiveNodeMove.Keep },
      siblingsGroupId: 7
    })
  })

  it('rejects an @-selected model when only another reply group is live', async () => {
    await dbh.db.insert(messageTable).values({
      id: 'a2',
      parentId: 'u1',
      topicId: 'topic-1',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'different group' }] },
      status: 'success',
      siblingsGroupId: 2,
      modelId: MODEL_ID,
      createdAt: 250,
      updatedAt: 250
    })

    await expect(
      provider.prepareDispatch(
        makeSubscriber(),
        {
          trigger: ConversationOpenTrigger.RegenerateMessage,
          conversation,
          parentAnchorId: 'u1',
          appendToLiveGroupMessageId: 'a2',
          mentionedModelIds: [MODEL_ID]
        },
        { hasLiveStream: true }
      )
    ).rejects.toMatchObject({ reason: ConversationAdmissionReason.TargetNotInLiveGroup })

    expect(messageService.getChildrenByParentId('u1')).toHaveLength(2)
  })

  it('rejects retry admission when the selected assistant is not in the current live reply group', async () => {
    await dbh.db.insert(messageTable).values({
      id: 'a2',
      parentId: 'u1',
      topicId: 'topic-1',
      role: 'assistant',
      data: { parts: [] },
      status: 'error',
      siblingsGroupId: 2,
      modelId: MODEL_ID,
      createdAt: 250,
      updatedAt: 250
    })

    await expect(
      provider.prepareDispatch(
        makeSubscriber(),
        {
          trigger: ConversationOpenTrigger.RegenerateMessage,
          conversation,
          parentAnchorId: 'u1',
          retryMessageId: 'a2',
          mentionedModelIds: [MODEL_ID]
        },
        { hasLiveStream: true }
      )
    ).rejects.toMatchObject({ reason: ConversationAdmissionReason.TargetNotInLiveGroup })

    expect(messageService.getById('a2').status).toBe('error')
  })

  it('rejects a live anchor with the same sibling id under another parent', async () => {
    await dbh.db.insert(messageTable).values([
      {
        id: 'u2',
        parentId: 'a1',
        topicId: 'topic-1',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'another turn' }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: 'a3',
        parentId: 'u2',
        topicId: 'topic-1',
        role: 'assistant',
        data: { parts: [] },
        status: 'pending',
        siblingsGroupId: 1,
        modelId: MODEL_ID,
        createdAt: 400,
        updatedAt: 400
      }
    ])

    await expect(
      provider.prepareDispatch(
        makeSubscriber(),
        {
          trigger: ConversationOpenTrigger.RegenerateMessage,
          conversation,
          parentAnchorId: 'u1',
          appendToLiveGroupMessageId: 'a3',
          mentionedModelIds: [createUniqueModelId('anthropic', 'claude-sonnet-4-5')]
        },
        { hasLiveStream: true }
      )
    ).rejects.toMatchObject({ reason: ConversationAdmissionReason.TargetNotInLiveGroup })
  })

  it('maps a missing persisted reply-group anchor to the live-group admission reason', async () => {
    vi.mocked(resolveModels).mockReturnValueOnce([
      { id: MODEL_ID, name: 'GPT-4o', providerId: 'openai', apiModelId: 'gpt-4o' }
    ] as ReturnType<typeof resolveModels>)
    vi.mocked(resolvePersistentSiblingsGroupId).mockReturnValueOnce(1)

    await expect(
      provider.prepareDispatch(
        makeSubscriber(),
        {
          trigger: ConversationOpenTrigger.RegenerateMessage,
          conversation,
          parentAnchorId: 'u1',
          appendToLiveGroupMessageId: 'missing-assistant',
          mentionedModelIds: [MODEL_ID]
        },
        { hasLiveStream: true }
      )
    ).rejects.toMatchObject({ reason: ConversationAdmissionReason.TargetNotInLiveGroup })
  })

  it('propagates database faults while checking a persisted reply-group anchor', async () => {
    vi.mocked(resolveModels).mockReturnValueOnce([
      { id: MODEL_ID, name: 'GPT-4o', providerId: 'openai', apiModelId: 'gpt-4o' }
    ] as ReturnType<typeof resolveModels>)
    vi.mocked(resolvePersistentSiblingsGroupId).mockReturnValueOnce(1)
    const databaseError = new Error('database disk image is malformed')
    const getById = vi.spyOn(messageService, 'getById').mockImplementationOnce(() => {
      throw databaseError
    })

    try {
      await expect(
        provider.prepareDispatch(
          makeSubscriber(),
          {
            trigger: ConversationOpenTrigger.RegenerateMessage,
            conversation,
            parentAnchorId: 'u1',
            appendToLiveGroupMessageId: 'a1',
            mentionedModelIds: [MODEL_ID]
          },
          { hasLiveStream: true }
        )
      ).rejects.toBe(databaseError)
    } finally {
      getById.mockRestore()
    }
  })
})

describe('PersistentChatContextProvider — prepareContinueDispatch (resume-after-approval)', () => {
  const dbh = setupTestDatabase()
  const provider = new PersistentChatHistoryHarness()

  // The anchor's persisted model differs from the test's default model so a
  // reuse failure (resolving the default instead of the anchor) is observable.
  const ANCHOR_MODEL_ID = createUniqueModelId('openai', 'gpt-4o-mini')
  const APPROVAL_ID = 'approval-1'

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(resolveModels).mockImplementation(
      (ids) =>
        (ids ?? [MODEL_ID]).map((id) => ({
          id,
          name: id === ANCHOR_MODEL_ID ? 'GPT-4o mini' : 'GPT-4o',
          providerId: 'openai',
          apiModelId: id === ANCHOR_MODEL_ID ? 'gpt-4o-mini' : 'gpt-4o'
        })) as ReturnType<typeof resolveModels>
    )
    const [providerKey, modelKey, anchorModelKey] = generateOrderKeySequence(3)
    await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: providerKey })
    await dbh.db.insert(userModelTable).values([
      {
        id: MODEL_ID,
        providerId: 'openai',
        modelId: 'gpt-4o',
        presetModelId: 'gpt-4o',
        name: 'GPT-4o',
        isEnabled: true,
        isHidden: false,
        orderKey: modelKey
      },
      {
        id: ANCHOR_MODEL_ID,
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
        presetModelId: 'gpt-4o-mini',
        name: 'GPT-4o mini',
        isEnabled: true,
        isHidden: false,
        orderKey: anchorModelKey
      }
    ])

    // topic-2 is a real but empty topic — lets the wrong-topic test reach the belonging
    // guard inside prepareContinueDispatch instead of failing earlier on a missing topic.
    await dbh.db.insert(topicTable).values([
      { id: 'topic-1', activeNodeId: 'a1', orderKey: 'a0' },
      { id: 'topic-2', activeNodeId: null, orderKey: 'a1' }
    ])
    await dbh.db.insert(messageTable).values(
      withRoot('topic-1', [
        {
          id: 'u1',
          parentId: null,
          topicId: 'topic-1',
          role: 'user',
          data: {
            parts: [
              { type: 'text', text: 'run the tool' },
              { type: 'data-knowledge-scope', data: { baseIds: ['kb-selected-for-approved-tool'] } }
            ]
          },
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        },
        {
          // Assistant turn paused on a tool-approval-request — the renderer's decision arrives here.
          id: 'a1',
          parentId: 'u1',
          topicId: 'topic-1',
          role: 'assistant',
          data: {
            turnOptions: { reasoningEffort: 'high', serviceTier: 'flex', fastMode: true },
            parts: [
              { type: 'text', text: 'let me call a tool' },
              {
                type: 'tool-fetch_url',
                toolCallId: 'call-1',
                state: 'approval-requested',
                input: { url: 'https://example.com' },
                approval: { id: APPROVAL_ID }
              }
            ]
          },
          status: 'success',
          siblingsGroupId: 1,
          modelId: ANCHOR_MODEL_ID,
          messageSnapshot: {
            id: 'asst-1',
            name: 'Anchor Assistant',
            emoji: '🤖',
            model: { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' }
          },
          stats: {
            runtimeTiming: {
              startedAt: 1_000,
              completedAt: 2_000,
              spans: []
            }
          },
          createdAt: 200,
          updatedAt: 200
        }
      ])
    )
  })

  it('rejects when the anchor is not an assistant message (anchor guard)', async () => {
    await expect(
      provider.prepareDispatch(
        makeSubscriber(),
        {
          trigger: ConversationContinuationTrigger.ContinueInteraction,
          conversation,
          parentAnchorId: 'u1', // a user message — invalid continue anchor
          approvalDecisions: []
        },
        { hasLiveStream: false }
      )
    ).rejects.toThrow(/anchor must be an assistant message/)
  })

  it('rejects when the anchor belongs to a different topic (anchor guard)', async () => {
    await expect(
      provider.prepareDispatch(
        makeSubscriber(),
        {
          trigger: ConversationContinuationTrigger.ContinueInteraction,
          conversation: { kind: ConversationKind.Chat, id: 'topic-2' }, // anchor a1 lives on topic-1
          parentAnchorId: 'a1',
          approvalDecisions: []
        },
        { hasLiveStream: false }
      )
    ).rejects.toThrow(/anchor does not belong to topic topic-2/)
  })

  it('flips the anchor status to pending and applies the approval decision to its parts', async () => {
    await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationContinuationTrigger.ContinueInteraction,
        conversation,
        parentAnchorId: 'a1',
        approvalDecisions: [{ approvalId: APPROVAL_ID, approved: true }]
      },
      { hasLiveStream: false }
    )

    const anchor = messageService.getById('a1')
    expect(anchor.status).toBe('pending')
    const toolPart = (anchor.data.parts ?? []).find((p) => p.type === 'tool-fetch_url') as
      | { state: string; approval?: { id: string; approved?: boolean } }
      | undefined
    expect(toolPart?.state).toBe('approval-responded')
    expect(toolPart?.approval).toEqual({ id: APPROVAL_ID, approved: true })
    expect(anchor.data.turnOptions).toEqual({ reasoningEffort: 'high', serviceTier: 'flex', fastMode: true })
  })

  it('records a denied live tool approval as a terminal tool state', () => {
    const result = provider.commitInteractionDecision('a1', {
      approvalId: APPROVAL_ID,
      approved: false,
      reason: 'user denied'
    })

    expect(result).toEqual({ kind: ConversationInteractionCommitResultKind.Ready })
    const anchor = messageService.getById('a1')
    const toolPart = (anchor.data.parts ?? []).find((part) => part.type === 'tool-fetch_url') as
      | { state: string; approval?: { id: string; approved?: boolean; reason?: string } }
      | undefined
    expect(toolPart).toMatchObject({
      state: 'approval-responded',
      approval: { id: APPROVAL_ID, approved: false, reason: 'user denied' }
    })
  })

  it("reuses the anchor's model and re-anchors history on the assistant row (no new placeholder)", async () => {
    const beforeCount = messageService.getPathToNode('a1').length
    vi.mocked(resolveModels).mockReturnValueOnce([
      { id: ANCHOR_MODEL_ID, name: 'GPT-4o mini', providerId: 'openai', apiModelId: 'gpt-4o-mini' }
    ] as ReturnType<typeof resolveModels>)

    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      {
        trigger: ConversationContinuationTrigger.ContinueInteraction,
        conversation,
        parentAnchorId: 'a1',
        approvalDecisions: [{ approvalId: APPROVAL_ID, approved: true }]
      },
      { hasLiveStream: false }
    )

    // Model reuse: the anchor's persisted modelId is what gets resolved, not the topic default.
    expect(resolveAssistantModelId).not.toHaveBeenCalled()
    expect(resolveModels).toHaveBeenCalledWith([ANCHOR_MODEL_ID], ANCHOR_MODEL_ID)

    // Single model, anchored back on the assistant row without keeping an unrelated live branch.
    expect(prepared.activeNodeDecision).toEqual({ move: ConversationActiveNodeMove.Advance })
    expect(prepared.models).toHaveLength(1)
    expect(prepared.models[0].modelId).toBe(ANCHOR_MODEL_ID)
    expect(prepared.models[0].request.messageId).toBe('a1')
    expect(prepared.models[0].request.knowledgeBaseIds).toEqual(['kb-selected-for-approved-tool'])
    expect(prepared.executions[0]?.runtimeTimingSeed).toEqual({
      startedAt: 1_000,
      completedAt: 2_000,
      spans: []
    })
    expect(prepared.models[0].request.reasoningEffort).toBe('high')
    expect(prepared.models[0].request.serviceTier).toBe('flex')
    expect(prepared.models[0].request.fastMode).toBe(true)

    // No placeholder row was created — the path to the anchor is unchanged.
    const afterCount = messageService.getPathToNode('a1').length
    expect(afterCount).toBe(beforeCount)

    // History anchors on the assistant row and carries the approval-responded part.
    const history = prepared.models[0].request.messages
    expect(history?.map((m) => m.role)).toEqual(['user', 'assistant'])
    const lastAssistant = history?.[history.length - 1]
    const toolPart = lastAssistant?.parts.find((p) => p.type === 'tool-fetch_url') as { state: string } | undefined
    expect(toolPart?.state).toBe('approval-responded')
  })
})
