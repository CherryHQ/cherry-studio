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

/** Like fakeMsg but carries stats.contextTokens for anchor-based trigger tests. */
function fakeMsgWithContextTokens(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  contextTokens: number
): Record<string, unknown> {
  return { ...fakeMsg(id, role, text), stats: { contextTokens } }
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

  it('5. over-budget by anchor → contextTokens base tips total over threshold', async () => {
    // Context window = 4000; trigger = floor(4000 * 0.8) = 3200.
    // a1 carries contextTokens = 3150 (just below 3200). The new user row u2 has
    // a tiny text (~5 tokens), so anchor+tail = 3150 + ~5 = ~3155... wait, that
    // is still under. Use contextTokens = 3190 so tail from u2 (~5 tokens) tips
    // it to ~3195, still under. Use 3195 + a bigger tail.
    //
    // Actually: contextTokens = 3180, u2 text = 'hi there how are you doing today' (~8 tokens)
    // → estimate = 3180 + 8 = 3188 < 3200. Not enough.
    //
    // Use contextTokens = 3195, u2 = 'question '.repeat(10) ≈ 10 tokens → 3205 > 3200. Triggers.
    // Full-tokenx on these tiny parts alone: a1 text = 'ok' (~1 tok) + u2 (~10 tok) = ~11 tok < 3200 → would NOT trigger.
    //
    // keepBudget = floor(4000 * 0.5) = 2000. planKeepBoundary over [a1(~1), u2(~10)] with budget=2000
    // → all fit (acc=11≤2000), keepStart=1 (u2 is user at idx 1), keepIdx=1 → boundary = recent[0] = a1 → null (keepStart===0 would be null but here keepIdx=1 is fine).
    // Wait: recent = rows after marker (no marker, d=-1) = [u1_row? No — no marker]. Let me recalculate:
    // rows = [u1, a1, u2]. effective = same (no marker). d = -1. recent = rows.slice(0) = [u1, a1, u2].
    // planKeepBoundary([u1,a1,u2], 2000): walk from tail: u2(~10)≤2000→keepStart=2; a1(~1)→11; u1(~10)→21≤2000→keepStart=0 (u1 is user).
    // keepStart=0 → returns null → no compaction. Hmm, keepStart===0 returns null.
    //
    // Fix: add more rows so the kept portion doesn't reach index 0.
    // [u1, a1(contextTokens=3195), u2, a2, u3]. effective = all 5.
    // estimateContext: find rightmost assistant with contextTokens → a1 at idx 1.
    // base=3195, tail = estimate(u2)+estimate(a2)+estimate(u3) = ~10+~5+~5 = ~20 → 3215 > 3200. Triggers.
    // Full-tokenx: ~10+~5+~10+~5+~5 = ~35 < 3200. Would NOT trigger. ✓
    //
    // planKeepBoundary([u1,a1,u2,a2,u3], 2000): walk from tail:
    //   u3(~5)→5, keepStart=4; a2(~5)→10; u2(~10)→20, keepStart=2; a1(~5)→25; u1(~10)→35 ≤2000, keepStart=0.
    //   keepStart=0 → null → no compaction via boundary. Hmm.
    //
    // Need bigger tail tokens so budget is exceeded before reaching idx 0.
    // Use MED = 'word '.repeat(300) ≈ 300 tokens. [u1, a1(ctx=3195), u2(MED), a2(MED), u3(MED)].
    // Full-tokenx: a1_text=~5, u1=~5, u2=300, a2=300, u3=300 → ~910 < 3200. Would NOT trigger.
    // estimateContext: anchor=a1(idx=1), base=3195, tail=u2(300)+a2(300)+u3(300)=900 → 4095 > 3200. Triggers. ✓
    // keepBudget=2000. planKeepBoundary: walk from tail: u3(300)→300,ks=4; a2(300)→600; u2(300)→900,ks=2; a1(~5)→905; u1(~5)→910 ≤2000 → ks=0 → null.
    //
    // Still null. Use window=10000. trigger=8000, keep=5000.
    // a1 ctx=7900, u2=MED(300), a2=MED(300), u3=MED(300). tail=900→8800>8000. Triggers.
    // Full-tokenx: ~5+5+300+300+300=910 < 8000. Would NOT trigger. ✓
    // keepBudget=5000. walk: u3(300)→300,ks=4; a2(300)→600; u2(300)→900,ks=2; a1(5)→905; u1(5)→910 ≤5000 → ks=0→null. Still null.
    //
    // The issue is all rows fit in budget. Need the tail alone to exceed keepBudget.
    // Use LARGE = 'word '.repeat(2000) ≈ 2000 tokens. window=10000, keep=5000.
    // [u1(LARGE), a1(ctx=7900), u2(LARGE), a2(LARGE), u3(LARGE)].
    // estimateContext: base=7900, tail=u2(2000)+a2(2000)+u3(2000)=6000 → 13900>8000. Triggers.
    // Full-tokenx: u1(2000)+a1(~5)+u2(2000)+a2(2000)+u3(2000)=~8005 > 8000 too. Would also trigger! Bad.
    //
    // The requirement: full-tokenx alone would NOT cross threshold, but anchor+delta does.
    // So: anchor brings in historical real usage that tokenx would never see.
    // Use a1 small text ('ok'), contextTokens=7900, u2=tiny, a2=tiny, u3=tiny.
    // Full-tokenx: all tiny = ~15 tok < 8000. Would NOT trigger. ✓
    // estimateContext: 7900 + ~10 = ~7910 > 8000? No 7910 < 8000.
    // Use contextTokens=8100 directly? No, that alone exceeds threshold with empty tail.
    // threshold=8000. contextTokens=7990, tail=u2(20tok)+a2(5tok)+u3(5tok)=30 → 8020>8000. Triggers!
    // Full-tokenx: a1(~1)+u1(~1)+u2(~20)+a2(~5)+u3(~5)=~32 < 8000. Would NOT. ✓
    // keepBudget=5000. walk: u3(5)→5,ks=4; a2(5)→10; u2(20)→30,ks=2; a1(1)→31; u1(1)→32 ≤5000 → ks=0→null.
    //
    // Still null! The problem is with only tiny messages, keep boundary always includes everything.
    // I need keepIdx !== null, which requires the budget to be exceeded before reaching index 0.
    // Use [u1(BIG=500), a1(ctx=7990,text=tiny), u2(tiny=20tok), a2(tiny), u3(tiny)].
    // keepBudget=5000. walk: u3(5)+a2(5)+u2(20)+a1(1)→31+u1(500)=531 ≤5000 → ks=0→null. Still null.
    //
    // Use window=1000. trigger=800, keep=500.
    // [u1(BIG=300tok), a1(ctx=790,text=tiny=1), u2(BIG=300), a2(BIG=300), u3(BIG=300)].
    // Full-tokenx: 300+1+300+300+300=1201 > 800. Would also trigger!
    //
    // The cleanest approach: use small text for u1 and a1 (so full-tokenx misses), but
    // LARGE text for u2/a2/u3 (so keepBudget is exceeded and boundary is found at u2).
    // window=10000, trigger=8000, keep=5000.
    // a1 contextTokens=7900 (real prior usage, huge), text=tiny.
    // u1=tiny. u2='word '.repeat(2000)=2000tok. a2='word '.repeat(2000). u3='word '.repeat(1000).
    // estimateContext: base=7900, tail=u2(2000)+a2(2000)+u3(1000)=5000 → 12900>8000. Triggers.
    // Full-tokenx: u1(~1)+a1(~1)+u2(2000)+a2(2000)+u3(1000)=~5002 < 8000. Would NOT. ✓
    // keepBudget=5000. walk from tail: u3(1000)→1000,ks=4; a2(2000)→3000; u2(2000)→5000,ks=2; a1(1)→5001>5000 → stop.
    // keepStart=2, keepIdx=2 (not null, not 0). boundary=recent[1]=a1. ✓

    const MED = 'word '.repeat(2000)
    const TRAIL = 'word '.repeat(1000)

    const path = [
      fakeMsg('u1', 'user', 'tiny question'),
      fakeMsgWithContextTokens('a1', 'assistant', 'ok', 7900),
      fakeMsg('u2', 'user', MED),
      fakeMsg('a2', 'assistant', MED),
      fakeMsg('u3', 'user', TRAIL)
    ]
    mockGetPathToNode.mockResolvedValue(path)
    compressionOn({})

    // Use a model with contextWindow=10000
    const { resolveModels } = await import('../modelResolution')
    const MODEL_ID_10K = createUniqueModelId('openai', 'gpt-4o-10k')
    vi.mocked(resolveModels).mockResolvedValueOnce([makeModel(MODEL_ID_10K, 10_000)])
    // Also patch createUserMessageWithPlaceholders for this one-off model id
    const { messageService } = await import('@main/data/services/MessageService')
    vi.mocked(messageService.createUserMessageWithPlaceholders).mockResolvedValueOnce({
      userMessage: fakeMsg('anchor', 'user', 'q') as any,
      placeholders: [fakeMsg('ph0', 'assistant', '') as any]
    })

    const provider = new PersistentChatContextProvider()
    await provider.prepareDispatch(
      makeSubscriber(),
      { trigger: 'submit-message', topicId: 'topic-1', parentAnchorId: 'u3', userMessageParts: [] } as any,
      { hasLiveStream: false }
    )

    // Anchor+tail exceeded threshold → compaction must have triggered
    expect(mockSummarizeModelMessages).toHaveBeenCalledTimes(1)
  })

  it('6. no anchor → fallback to full tokenx; under budget → no compaction', async () => {
    // No row carries contextTokens → estimateContext falls back to estimateTotal (full tokenx).
    // Tiny messages → full tokenx well under threshold → no compaction.
    const path = [fakeMsg('u1', 'user', 'hello'), fakeMsg('a1', 'assistant', 'hi'), fakeMsg('u2', 'user', 'goodbye')]
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
})
