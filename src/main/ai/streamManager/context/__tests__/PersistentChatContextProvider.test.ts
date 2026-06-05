import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { startAiTurnTrace } from '../../../observability'
import { PersistenceListener } from '../../listeners/PersistenceListener'
import type { StreamListener } from '../../types'
import { resolveModels, resolvePersistentSiblingsGroupId } from '../modelResolution'

// Stub model resolution + tracing so the test drives the REAL DB history path
// (`createUserMessageWithPlaceholders` → `getPathToNode`) without provider/model
// resolution machinery. The history is what we assert on.
const MODEL_ID = createUniqueModelId('openai', 'gpt-4o')
vi.mock('../modelResolution', () => ({
  resolveAssistantModelId: vi.fn(async () => ({ assistantId: undefined, defaultModelId: MODEL_ID })),
  resolveModels: vi.fn(async () => [{ id: MODEL_ID, name: 'GPT-4o', providerId: 'openai', apiModelId: 'gpt-4o' }]),
  resolvePersistentSiblingsGroupId: vi.fn(async () => 1)
}))

vi.mock('../../../observability', () => ({
  startAiTurnTrace: vi.fn(() => ({ rootSpan: { end: vi.fn() }, traceId: 'trace-1' }))
}))

const { PersistentChatContextProvider } = await import('../PersistentChatContextProvider')

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

describe('PersistentChatContextProvider — steer-restart history (#B4)', () => {
  const dbh = setupTestDatabase()
  const provider = new PersistentChatContextProvider()

  // The text the model was mid-producing when the user steered; persisted on the
  // assistant row as `paused` by `abortAndAwait` before the prompt is rebuilt.
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
    await dbh.db.insert(messageTable).values([
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
  })

  it('rebuilds a prompt that carries the paused partial when the new turn anchors on the paused row', async () => {
    // Steering: renderer's `activeNodeId` (the streaming/paused assistant row) is sent as
    // `parentAnchorId`, so the new user message is parented on the paused row.
    const prepared = await provider.prepareDispatch(makeSubscriber(), {
      trigger: 'submit-message',
      topicId: 'topic-1',
      parentAnchorId: 'a1',
      userMessageParts: [{ type: 'text', text: 'actually, change direction' }]
    } as AiStreamOpenRequest)

    const history = prepared.models[0].request.messages
    expect(history).toBeDefined()
    expect(flatten(history!)).toEqual([
      { role: 'user', text: 'first question' },
      // The paused partial survives into the rebuilt prompt — this is the B4 efficacy guarantee.
      { role: 'assistant', text: PARTIAL },
      { role: 'user', text: 'actually, change direction' }
    ])
  })

  it('drops the paused partial when the new turn does not anchor on it (precondition is necessary)', async () => {
    // Counter-case: anchoring on the prior user message (not the paused assistant row) rebuilds
    // a prompt WITHOUT the partial — proving the efficacy hinges on `parentAnchorId` = paused row.
    const prepared = await provider.prepareDispatch(makeSubscriber(), {
      trigger: 'submit-message',
      topicId: 'topic-1',
      parentAnchorId: 'u1',
      userMessageParts: [{ type: 'text', text: 'retry from before' }]
    } as AiStreamOpenRequest)

    expect(flatten(prepared.models[0].request.messages!)).toEqual([
      { role: 'user', text: 'first question' },
      { role: 'user', text: 'retry from before' }
    ])
  })

  it('fans out @-mentioned siblings: shared siblingsGroupId, one placeholder per model, aligned placeholders[i]/turnRootSpans[i]', async () => {
    // Two @-mentioned models → two assistant placeholders sharing one siblings group.
    // Each placeholder row persists ITS span's traceId; assert the per-model row, span,
    // and traceId all line up by index so a fan-out never crosses streams.
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
    vi.mocked(resolveModels).mockResolvedValueOnce([
      { id: MODEL_A, name: 'GPT-4o', providerId: 'openai', apiModelId: 'gpt-4o' },
      { id: MODEL_B, name: 'Claude Sonnet 4.5', providerId: 'anthropic', apiModelId: 'claude-sonnet-4-5' }
    ] as Awaited<ReturnType<typeof resolveModels>>)
    vi.mocked(resolvePersistentSiblingsGroupId).mockResolvedValueOnce(42)
    // Distinct span + traceId per call so index alignment is observable.
    const spanA = { end: vi.fn() }
    const spanB = { end: vi.fn() }
    vi.mocked(startAiTurnTrace)
      .mockReturnValueOnce({ rootSpan: spanA, traceId: 'trace-a' } as unknown as ReturnType<typeof startAiTurnTrace>)
      .mockReturnValueOnce({ rootSpan: spanB, traceId: 'trace-b' } as unknown as ReturnType<typeof startAiTurnTrace>)

    const prepared = await provider.prepareDispatch(makeSubscriber(), {
      trigger: 'submit-message',
      topicId: 'topic-1',
      parentAnchorId: 'u1',
      mentionedModelIds: [MODEL_A, MODEL_B],
      userMessageParts: [{ type: 'text', text: 'ask both models' }]
    } as AiStreamOpenRequest)

    // Shared sibling group + multi-model flag.
    expect(prepared.siblingsGroupId).toBe(42)
    expect(prepared.isMultiModel).toBe(true)

    // One execution per model, in mention order, each carrying its own root span.
    expect(prepared.models.map((m) => m.modelId)).toEqual([MODEL_A, MODEL_B])
    expect(prepared.models[0].rootSpan).toBe(spanA)
    expect(prepared.models[1].rootSpan).toBe(spanB)

    // One persisted placeholder per model, both in the shared group, each routed to its
    // own request — placeholders[i]/turnRootSpans[i] alignment proven via per-row traceId.
    const placeholders = await messageService.getChildrenByParentId(prepared.userMessageId!)
    expect(placeholders).toHaveLength(2)
    const byTrace = new Map(placeholders.map((p) => [p.traceId, p]))
    const phA = byTrace.get('trace-a')
    const phB = byTrace.get('trace-b')
    expect(phA?.modelId).toBe(MODEL_A)
    expect(phB?.modelId).toBe(MODEL_B)
    expect(phA?.siblingsGroupId).toBe(42)
    expect(phB?.siblingsGroupId).toBe(42)
    expect(prepared.models[0].request.messageId).toBe(phA?.id)
    expect(prepared.models[1].request.messageId).toBe(phB?.id)

    // One PersistenceListener per placeholder — no missing/extra/duplicate listener for a fan-out.
    const persistenceListeners = prepared.listeners.filter((l) => l instanceof PersistenceListener)
    expect(persistenceListeners).toHaveLength(2)
    // Each listener is keyed (via its sqlite-backed id `persistence:sqlite:<topicId>:<modelId>`) to the
    // model whose execution carries the matching placeholder messageId — so terminal events route to the
    // right row. modelId order matches the per-model executions, proving listener[i] ↔ placeholder[i].
    expect(persistenceListeners.map((l) => l.id)).toEqual([
      `persistence:sqlite:topic-1:${MODEL_A}`,
      `persistence:sqlite:topic-1:${MODEL_B}`
    ])
  })
})

describe('PersistentChatContextProvider — prepareContinueDispatch (resume-after-approval)', () => {
  const dbh = setupTestDatabase()
  const provider = new PersistentChatContextProvider()

  // The anchor's persisted model differs from the test's default model so a
  // reuse failure (resolving the default instead of the anchor) is observable.
  const ANCHOR_MODEL_ID = createUniqueModelId('openai', 'gpt-4o-mini')
  const APPROVAL_ID = 'approval-1'

  beforeEach(async () => {
    vi.clearAllMocks()
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
    await dbh.db.insert(messageTable).values([
      {
        id: 'u1',
        parentId: null,
        topicId: 'topic-1',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'run the tool' }] },
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
        modelSnapshot: { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' },
        createdAt: 200,
        updatedAt: 200
      }
    ])
  })

  it('rejects when the anchor is not an assistant message (anchor guard)', async () => {
    await expect(
      provider.prepareDispatch(makeSubscriber(), {
        trigger: 'continue-conversation',
        topicId: 'topic-1',
        parentAnchorId: 'u1', // a user message — invalid continue anchor
        approvalDecisions: []
      })
    ).rejects.toThrow(/anchor must be an assistant message/)
  })

  it('rejects when the anchor belongs to a different topic (anchor guard)', async () => {
    await expect(
      provider.prepareDispatch(makeSubscriber(), {
        trigger: 'continue-conversation',
        topicId: 'topic-2', // anchor a1 lives on topic-1
        parentAnchorId: 'a1',
        approvalDecisions: []
      })
    ).rejects.toThrow(/anchor does not belong to topic topic-2/)
  })

  it('flips the anchor status to pending and applies the approval decision to its parts', async () => {
    await provider.prepareDispatch(makeSubscriber(), {
      trigger: 'continue-conversation',
      topicId: 'topic-1',
      parentAnchorId: 'a1',
      approvalDecisions: [{ approvalId: APPROVAL_ID, approved: true }]
    })

    const anchor = await messageService.getById('a1')
    expect(anchor.status).toBe('pending')
    const toolPart = (anchor.data.parts ?? []).find((p) => p.type === 'tool-fetch_url') as
      | { state: string; approval?: { id: string; approved?: boolean } }
      | undefined
    expect(toolPart?.state).toBe('approval-responded')
    expect(toolPart?.approval).toEqual({ id: APPROVAL_ID, approved: true })
  })

  it("reuses the anchor's model and re-anchors history on the assistant row (no new placeholder)", async () => {
    const beforeCount = (await messageService.getPathToNode('a1')).length

    const prepared = await provider.prepareDispatch(makeSubscriber(), {
      trigger: 'continue-conversation',
      topicId: 'topic-1',
      parentAnchorId: 'a1',
      approvalDecisions: [{ approvalId: APPROVAL_ID, approved: true }]
    })

    // Model reuse: the anchor's persisted modelId is what gets resolved, not the topic default.
    expect(vi.mocked(resolveModels)).toHaveBeenCalledWith([ANCHOR_MODEL_ID], MODEL_ID)

    // Single model, no sibling group, anchored back on the assistant row.
    expect(prepared.isMultiModel).toBe(false)
    expect(prepared.siblingsGroupId).toBeUndefined()
    expect(prepared.models).toHaveLength(1)
    expect(prepared.models[0].request.messageId).toBe('a1')

    // No placeholder row was created — the path to the anchor is unchanged.
    const afterCount = (await messageService.getPathToNode('a1')).length
    expect(afterCount).toBe(beforeCount)

    // History anchors on the assistant row and carries the approval-responded part.
    const history = prepared.models[0].request.messages
    expect(history?.map((m) => m.role)).toEqual(['user', 'assistant'])
    const lastAssistant = history?.[history.length - 1]
    const toolPart = lastAssistant?.parts.find((p) => p.type === 'tool-fetch_url') as { state: string } | undefined
    expect(toolPart?.state).toBe('approval-responded')
  })
})
