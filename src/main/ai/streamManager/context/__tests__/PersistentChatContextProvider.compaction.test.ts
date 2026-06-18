/**
 * Integration tests for durable compaction in PersistentChatContextProvider.
 * Verifies resolveCompactedHistory behaviour at the four key boundaries:
 *   1. under budget, no marker → full history, no summarization
 *   2. over budget → summarize + persist + serve compacted view
 *   3. existing marker, under budget → apply marker, no new summarization
 *   4. multiple markers on path → deepest wins
 */

import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted() ensures these vi.fn() instances are available when vi.mock factories run
// (vi.mock calls are hoisted to the top of the file by Vitest's transform).
const { mockGetPathToNode, mockSetCompactionSummary, mockResolveRequestContextSettings, mockSummarizeModelMessages } =
  vi.hoisted(() => ({
    mockGetPathToNode: vi.fn(),
    mockSetCompactionSummary: vi.fn(),
    mockResolveRequestContextSettings: vi.fn(),
    mockSummarizeModelMessages: vi.fn()
  }))

// Mock messageService at the source path used by the provider.
// Both @main/data/services/MessageService and @data/services/MessageService resolve
// to the same module (src/main/data/services/MessageService) via the build aliases.
vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    getPathToNode: mockGetPathToNode,
    setCompactionSummary: mockSetCompactionSummary,
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createUserMessageWithPlaceholders: vi.fn(),
    getChildrenByParentId: vi.fn()
  }
}))

// Mock resolveRequestContextSettings — controls whether compression is on.
// Path relative to this test file: __tests__ → context → streamManager → ai → contextBuild
vi.mock('../../../contextBuild/resolveRequestContextSettings', () => ({
  resolveRequestContextSettings: mockResolveRequestContextSettings
}))

// Mock summarizeModelMessages — returns 'SUMMARY_TEXT' by default
vi.mock('@context-chef/ai-sdk-middleware', () => ({
  summarizeModelMessages: mockSummarizeModelMessages
}))

// Mock prepareModelMessages — returns empty array (content doesn't matter for these tests).
// Path relative to this test file: __tests__ → context → streamManager → ai → messages
vi.mock('../../../messages/messageConverter', () => ({
  prepareModelMessages: vi.fn(async () => []),
  toCherryUIMessage: vi.fn(),
  resolveUIMessageFileUrls: vi.fn(async (msgs: unknown[]) => msgs)
}))

// Override the global @application mock to also handle AiStreamManager lookups.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('../../../../../../tests/__mocks__/main/application')
  const base = mockApplicationFactory()
  const originalGet = base.application.get
  base.application.get = vi.fn((name: string) => {
    if (name === 'AiStreamManager') {
      return { broadcastTopicError: vi.fn() }
    }
    return originalGet(name)
  })
  return base
})

/** A minimal Model object with required fields for resolveModels mock. */
function makeModel(id: UniqueModelId, contextWindow = 4000) {
  return {
    id,
    name: id,
    providerId: 'openai',
    apiModelId: 'gpt-4o',
    contextWindow,
    capabilities: [] as never[],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

const DEFAULT_MODEL_ID = createUniqueModelId('openai', 'gpt-4o')

vi.mock('../modelResolution', () => ({
  resolveAssistantModelId: vi.fn(async () => ({
    assistantId: undefined,
    defaultModelId: 'openai::gpt-4o' as UniqueModelId
  })),
  resolveModels: vi.fn(async (ids: string[] | undefined) =>
    (ids ?? ['openai::gpt-4o']).map((id) => makeModel(id as UniqueModelId))
  ),
  resolvePersistentSiblingsGroupId: vi.fn(async () => 1)
}))

vi.mock('../../../observability', () => ({
  startAiTurnTrace: vi.fn(() => ({ rootSpan: { end: vi.fn(), setStatus: vi.fn() }, traceId: 'trace-1' }))
}))

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    getById: vi.fn(async () => ({ id: 'topic-1', assistantId: undefined, activeNodeId: 'u1', orderKey: 'a0' }))
  }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: {
    maybeRenameFromFirstUserMessage: vi.fn(),
    maybeRenameFromConversationSummary: vi.fn()
  }
}))

// Import provider after all mocks are in place.
const { PersistentChatContextProvider } = await import('../PersistentChatContextProvider')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal fake Message that carries the fields toRow() needs. */
function fakeMsg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  compactionSummary?: string
): Record<string, unknown> {
  return {
    id,
    role,
    topicId: 'topic-1',
    data: { parts: [{ type: 'text', text }] },
    status: 'success',
    compactionSummary: compactionSummary ?? null,
    parentId: null,
    siblingsGroupId: 0,
    createdAt: 0,
    updatedAt: 0,
    modelId: DEFAULT_MODEL_ID,
    modelSnapshot: null,
    stats: null
  }
}

function compressionOn(compressionModel: unknown = {}) {
  mockResolveRequestContextSettings.mockResolvedValue({
    contextSettings: { enabled: true, truncateThreshold: 0.9, compress: { enabled: true } },
    compressionModel
  })
}

function makeSubscriber() {
  return { id: 'wc:1', onChunk: vi.fn(), onDone: vi.fn(), onPaused: vi.fn(), onError: vi.fn(), isAlive: () => true }
}

/** Call prepareDispatch with a submit-message trigger pointing to the given anchorId.
 *  Returns `{ messages, prepared }` where messages is the first model's request messages array. */
async function makeHistory(anchorId: string, models = [DEFAULT_MODEL_ID]) {
  const { resolveModels } = await import('../modelResolution')
  vi.mocked(resolveModels).mockResolvedValueOnce(models.map((id) => makeModel(id)))
  // Mock createUserMessageWithPlaceholders so prepareDispatch doesn't need a real DB.
  const { messageService } = await import('@main/data/services/MessageService')
  vi.mocked(messageService.createUserMessageWithPlaceholders).mockResolvedValueOnce({
    userMessage: fakeMsg('anchor', 'user', 'q') as any,
    placeholders: models.map((_, i) => fakeMsg(`ph${i}`, 'assistant', '') as any)
  })

  const provider = new PersistentChatContextProvider()
  const prepared = await provider.prepareDispatch(
    makeSubscriber(),
    { trigger: 'submit-message', topicId: 'topic-1', parentAnchorId: anchorId, userMessageParts: [] } as any,
    { hasLiveStream: false }
  )
  return { messages: prepared.models[0].request.messages ?? [], prepared }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PersistentChatContextProvider — durable compaction integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSummarizeModelMessages.mockResolvedValue('SUMMARY_TEXT')
  })

  it('1. under budget, no marker → full history served, no summarization', async () => {
    // 3 tiny messages — well under 4000 * 0.8 = 3200 token trigger threshold
    const path = [
      fakeMsg('u1', 'user', 'hello'),
      fakeMsg('a1', 'assistant', 'hi'),
      fakeMsg('u2', 'user', 'how are you')
    ]
    mockGetPathToNode.mockResolvedValue(path)
    compressionOn()

    const { messages } = await makeHistory('u2')

    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
    expect(mockSetCompactionSummary).not.toHaveBeenCalled()
    const ids = messages.map((m) => m.id)
    expect(ids).toContain('u1')
    expect(ids).toContain('a1')
    expect(ids).toContain('u2')
  })

  it('2. over budget → summarize + persist on boundary + serve compacted view', async () => {
    // Use massive text so total tokens exceed 4000 * 0.8 = 3200 token trigger.
    // Each 'token '.repeat(700) block ≈ 700 tokens × 5 messages = 3500 > 3200.
    // keepBudget = floor(4000 * 0.5) = 2000.
    // Walking from tail: u3(700)≤2000 → keepStart=4; a2(700)→1400; u2(700)→2100>2000 → stop.
    // keepIdx=4, boundary = recent[3] = a2.
    const BIG = 'token '.repeat(700)

    const path = [
      fakeMsg('u1', 'user', BIG),
      fakeMsg('a1', 'assistant', BIG),
      fakeMsg('u2', 'user', BIG),
      fakeMsg('a2', 'assistant', BIG),
      fakeMsg('u3', 'user', BIG)
    ]
    mockGetPathToNode.mockResolvedValue(path)
    compressionOn({}) // compressionModel is truthy ({} is a valid non-null model)

    const { messages } = await makeHistory('u3')

    // summarizeModelMessages called once (compaction triggered)
    expect(mockSummarizeModelMessages).toHaveBeenCalledTimes(1)

    // setCompactionSummary called on boundary row (a2, the row just before the kept user row u3)
    expect(mockSetCompactionSummary).toHaveBeenCalledTimes(1)
    const [boundaryId, summaryText] = mockSetCompactionSummary.mock.calls[0]
    expect(summaryText).toBe('SUMMARY_TEXT')
    expect(boundaryId).not.toMatch(/^compaction:/) // real row, not synthetic
    expect(boundaryId).toBeTruthy()

    // First returned message is the synthetic summary row
    expect(messages[0].id).toBe(`compaction:${boundaryId}`)
    // Kept tail starts with a user row
    expect(messages[1].role).toBe('user')
  })

  it('3. existing marker, under budget → apply marker, no new summarization', async () => {
    // a1 has a compactionSummary → applyDeepestMarker replaces [u1,a1] with [summary(a1)].
    // Resulting effective = [summary(a1), u2, a2, u3] — well under 3200 token threshold.
    const path = [
      fakeMsg('u1', 'user', 'old question'),
      fakeMsg('a1', 'assistant', 'old answer', 'PRIOR SUMMARY'),
      fakeMsg('u2', 'user', 'new question'),
      fakeMsg('a2', 'assistant', 'new answer'),
      fakeMsg('u3', 'user', 'latest question')
    ]
    mockGetPathToNode.mockResolvedValue(path)
    compressionOn()

    const { messages } = await makeHistory('u3')

    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
    expect(mockSetCompactionSummary).not.toHaveBeenCalled()

    // First message is the synthetic summary row for a1
    expect(messages[0].id).toBe('compaction:a1')
    const ids = messages.map((m) => m.id)
    expect(ids).toContain('u2')
    expect(ids).toContain('a2')
    expect(ids).toContain('u3')
    // u1 and raw a1 must not appear
    expect(ids).not.toContain('u1')
    expect(ids).not.toContain('a1')
  })

  it('4. multiple markers on path → uses the deepest; rows before it dropped', async () => {
    // Both a1 and a3 carry compactionSummaries; a3 is deeper → deepest wins.
    // Effective = [summary(a3), u4, u5].
    const path = [
      fakeMsg('u1', 'user', 'q1'),
      fakeMsg('a1', 'assistant', 'r1', 'SUMMARY_A1'), // earlier marker
      fakeMsg('u2', 'user', 'q2'),
      fakeMsg('a3', 'assistant', 'r3', 'SUMMARY_A3'), // deepest marker
      fakeMsg('u4', 'user', 'q4'),
      fakeMsg('u5', 'user', 'q5')
    ]
    mockGetPathToNode.mockResolvedValue(path)
    compressionOn()

    const { messages } = await makeHistory('u5')

    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
    expect(mockSetCompactionSummary).not.toHaveBeenCalled()

    // deepest marker is a3 → synthetic summary row uses its id
    expect(messages[0].id).toBe('compaction:a3')
    const ids = messages.map((m) => m.id)
    expect(ids).toContain('u4')
    expect(ids).toContain('u5')
    // All rows at or before a3 must be absent
    expect(ids).not.toContain('u1')
    expect(ids).not.toContain('a1')
    expect(ids).not.toContain('u2')
    expect(ids).not.toContain('a3')
  })
})
