/**
 * Integration tests for durable compaction in PersistentChatContextProvider.
 * Verifies resolveCompactedHistory behaviour at the four key boundaries:
 *   1. under budget, no marker → full history, no summarization
 *   2. over budget → summarize + persist + serve compacted view
 *   3. existing marker, under budget → apply marker, no new summarization
 *   4. multiple markers on path → deepest wins
 */

import type * as AiCore from '@cherrystudio/ai-core'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { estimateTokenCount } from 'tokenx'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted() ensures these vi.fn() instances are available when vi.mock factories run
// (vi.mock calls are hoisted to the top of the file by Vitest's transform).
const {
  mockGetProviderById,
  mockResolveEffectiveEndpoint,
  mockGetPathToNode,
  mockSetCompactionSummary,
  mockResolveRequestContextSettings,
  mockSummarizeModelMessages,
  mockCompactModelMessages,
  mockGetAssistantById,
  mockFindFileEntryById
} = vi.hoisted(() => ({
  mockGetProviderById: vi.fn(),
  mockResolveEffectiveEndpoint: vi.fn(),
  mockGetPathToNode: vi.fn(),
  mockSetCompactionSummary: vi.fn(),
  mockResolveRequestContextSettings: vi.fn(),
  mockSummarizeModelMessages: vi.fn(),
  mockCompactModelMessages: vi.fn(),
  mockGetAssistantById: vi.fn(),
  mockFindFileEntryById: vi.fn()
}))

// The provider reads assistant.settings.contextSettings for the P2-D override.
// Default: throws NOT_FOUND (assistantId undefined in most tests → never called;
// the passthrough test overrides it).
vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: { getById: mockGetAssistantById }
}))

// collectPersistedOutputPaths' ownership gate (resolveOwnedBlobPath) verifies the
// blob's entry is an owned tool-output blob before serving its path — otherwise it
// skips the path. Default to a valid owned tool-output blob entry so persisted
// outputs reach the allow-list; foreign/missing cases aren't exercised here.
// The output reservation resolves the endpoint per model — only the Anthropic
// endpoint puts max_tokens on the wire, so only it shrinks the input room.
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: mockGetProviderById }
}))
vi.mock('@main/ai/provider/endpoint', () => ({
  resolveEffectiveEndpoint: mockResolveEffectiveEndpoint
}))

vi.mock('@data/services/FileEntryService', () => ({
  fileEntryService: { findById: mockFindFileEntryById }
}))

// Mock messageService at the source path used by the provider.
// Both @main/data/services/MessageService and @data/services/MessageService resolve
// to the same module (src/main/data/services/MessageService) via the build aliases.
vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    getPathToNode: mockGetPathToNode,
    setCompactionSummary: mockSetCompactionSummary,
    getById: vi.fn(),
    isAwaitingInputLeaf: vi.fn(() => false),
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

// Mock the context-module summarizers. summarizeModelMessages (turn-start fold) returns
// 'SUMMARY_TEXT' by default; compactModelMessages (in-loop hook) is wired so the
// interaction test can assert it is NOT called at step 0 and IS called on growth.
vi.mock('@cherrystudio/ai-core', async (importOriginal) => ({
  ...(await importOriginal<typeof AiCore>()),
  summarizeModelMessages: mockSummarizeModelMessages,
  compactModelMessages: mockCompactModelMessages
}))

// Override the global @application mock to also handle AiStreamManager lookups
// and give FileManager a deterministic getPhysicalPath (the shared mock lacks
// one, and collectPersistedOutputPaths swallows lookup errors — without this
// the persisted-path assertions would silently pass on an empty set).
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('../../../../../../tests/__mocks__/main/application')
  const base = mockApplicationFactory()
  const originalGet = base.application.get
  base.application.get = vi.fn((name: string) => {
    if (name === 'AiStreamManager') {
      return { broadcastTopicError: vi.fn() }
    }
    if (name === 'FileManager') {
      return { getPhysicalPath: (id: string) => `/blobs/${id}.txt` }
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
    maxOutputTokens: undefined as number | undefined,
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
  resolveAssistantModelId: vi.fn(() => ({
    assistantId: undefined,
    defaultModelId: 'openai::gpt-4o' as UniqueModelId
  })),
  resolveModels: vi.fn((ids: string[] | undefined) =>
    (ids ?? ['openai::gpt-4o']).map((id) => makeModel(id as UniqueModelId))
  ),
  resolvePersistentSiblingsGroupId: vi.fn(() => 1)
}))

vi.mock('../../../observability', () => ({
  startAiChildTurnSpan: vi.fn(() => ({ rootSpan: { end: vi.fn(), setStatus: vi.fn() } })),
  applyTurnInputAttributes: vi.fn()
}))

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    getById: vi.fn(() => ({ id: 'topic-1', assistantId: undefined, activeNodeId: 'u1', orderKey: 'a0' })),
    ensureTraceId: vi.fn(() => 'trace-1')
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

// The in-loop hook (real implementation) and the served-history → ModelMessage[]
// bridge. convertToModelMessages is the real `ai` helper (not mocked here); it is
// the same conversion the Agent applies downstream to the served history, so it
// faithfully reproduces the prompt the in-loop hook would actually measure.
const { inLoopCompactionFeature } = await import('../../../runtime/aiSdk/params/features/inLoopCompaction')
const { convertToModelMessages } = await import('ai')

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

function compressionOn(compressionModel: unknown = { languageModel: {}, contextWindow: null }, thresholdPercent = 80) {
  mockResolveRequestContextSettings.mockResolvedValue({
    contextSettings: {
      enabled: true,
      truncateThreshold: 0.9,
      maxMessages: null,
      compress: { enabled: true, thresholdPercent }
    },
    compressionModel
  })
}

/** Bounded scope: maxMessages set → serve the last-N window, skip folding. */
function maxMessagesOn(maxMessages: number, enabled = true) {
  mockResolveRequestContextSettings.mockResolvedValue({
    contextSettings: { enabled, truncateThreshold: 0.9, maxMessages, compress: { enabled: true } },
    compressionModel: { languageModel: {}, contextWindow: null }
  })
}

/** Chunks the provider streamed this test (compaction anchors ride here). */
let capturedChunks: Array<{ type: string; id?: string; data: { status: string; phase: string } }> = []

function makeSubscriber() {
  return {
    id: 'wc:1',
    onChunk: vi.fn((chunk) => capturedChunks.push(chunk)),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  }
}

/** Call prepareDispatch with a submit-message trigger pointing to the given anchorId.
 *  Returns `{ messages, prepared }` where messages is the first model's request messages array. */
async function makeHistory(
  anchorId: string,
  models = [DEFAULT_MODEL_ID],
  /** Patch the resolved Model rows (e.g. drop or widen `contextWindow`). */
  modelPatch?: Partial<ReturnType<typeof makeModel>>
) {
  const { resolveModels } = await import('../modelResolution')
  vi.mocked(resolveModels).mockReturnValueOnce(models.map((id) => ({ ...makeModel(id), ...modelPatch })))
  // Mock createUserMessageWithPlaceholders so prepareDispatch doesn't need a real DB.
  const { messageService } = await import('@main/data/services/MessageService')
  vi.mocked(messageService.createUserMessageWithPlaceholders).mockReturnValueOnce({
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
    capturedChunks = []
    mockSummarizeModelMessages.mockResolvedValue('SUMMARY_TEXT')
    // Default: an endpoint that sends no max_tokens, so the input room is the
    // whole window and every pre-existing trigger arithmetic below still holds.
    mockGetProviderById.mockReturnValue({ id: 'openai' })
    mockResolveEffectiveEndpoint.mockReturnValue({ endpointType: 'openai-chat-completions' })
    // Default: no assistant reachable (matches assistantId=undefined in most tests).
    mockGetAssistantById.mockImplementation(() => {
      throw new Error('NOT_FOUND')
    })
    // Owned tool-output blob entry → passes resolveOwnedBlobPath's isToolOutputBlobEntry gate.
    mockFindFileEntryById.mockReturnValue({ origin: 'internal', cleanupPolicy: 'delete_when_unreferenced', ext: 'txt' })
  })

  it('1. under budget, no marker → full history served, no summarization', async () => {
    // 3 tiny messages — well under 4000 * 0.8 = 3200 token trigger threshold
    const path = [
      fakeMsg('u1', 'user', 'hello'),
      fakeMsg('a1', 'assistant', 'hi'),
      fakeMsg('u2', 'user', 'how are you')
    ]
    mockGetPathToNode.mockReturnValue(path)
    compressionOn()

    const { messages } = await makeHistory('u2')

    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
    expect(mockSetCompactionSummary).not.toHaveBeenCalled()
    const ids = messages.map((m) => m.id)
    expect(ids).toContain('u1')
    expect(ids).toContain('a1')
    expect(ids).toContain('u2')
  })

  it('1b. maxMessages set → serves the last-N window and skips turn-start folding even over budget', async () => {
    // Same over-budget shape as test 2 — without maxMessages this WOULD fold.
    const BIG = 'token '.repeat(700)
    const path = [
      fakeMsg('u1', 'user', BIG),
      fakeMsg('a1', 'assistant', BIG),
      fakeMsg('u2', 'user', BIG),
      fakeMsg('a2', 'assistant', BIG),
      fakeMsg('u3', 'user', BIG)
    ]
    mockGetPathToNode.mockReturnValue(path)
    maxMessagesOn(3)

    const { messages } = await makeHistory('u3')

    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
    expect(mockSetCompactionSummary).not.toHaveBeenCalled()
    expect(messages.map((m) => m.id)).toEqual(['u2', 'a2', 'u3'])
  })

  it('1c. maxMessages=1 serves only the current user message (stateless assistant)', async () => {
    const path = [
      fakeMsg('u1', 'user', 'hello'),
      fakeMsg('a1', 'assistant', 'hi'),
      fakeMsg('u2', 'user', 'translate this')
    ]
    mockGetPathToNode.mockReturnValue(path)
    maxMessagesOn(1)

    const { messages } = await makeHistory('u2')

    expect(messages.map((m) => m.id)).toEqual(['u2'])
    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
  })

  it('1d. maxMessages still bounds the window when the context-management master switch is off', async () => {
    // The master switch owns the overflow policy, so it must not silently
    // serve full history to someone who asked for "last 1 message".
    const path = [
      fakeMsg('u1', 'user', 'hello'),
      fakeMsg('a1', 'assistant', 'hi'),
      fakeMsg('u2', 'user', 'translate this')
    ]
    mockGetPathToNode.mockReturnValue(path)
    maxMessagesOn(1, false)

    const { messages } = await makeHistory('u2')

    expect(messages.map((m) => m.id)).toEqual(['u2'])
    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
  })

  it('1e. a maxMessages window revokes read_file/fs_read access to what slid out', async () => {
    // Leaving the raw-path context in place let the model pull the excluded
    // attachment back in through read_file, defeating the setting.
    const attachedMsg = fakeMsg('u1', 'user', 'here is the doc')
    ;(attachedMsg.data as { parts: unknown[] }).parts.push({
      type: 'file',
      mediaType: 'text/plain',
      url: 'file:///tmp/doc.txt',
      filename: 'doc.txt',
      providerMetadata: { cherry: { fileEntryId: 'fe-1' } }
    })
    mockGetPathToNode.mockReturnValue([attachedMsg, fakeMsg('a1', 'assistant', 'ok'), fakeMsg('u2', 'user', '现在呢')])
    maxMessagesOn(1)

    const { messages, prepared } = await makeHistory('u2')

    expect(messages.map((m) => m.id)).toEqual(['u2'])
    expect(prepared.models[0].request.retainedContext?.fileAttachments).toEqual([])
  })

  it('1f. a maxMessages window keeps attachments that are still inside it', async () => {
    const attachedMsg = fakeMsg('u2', 'user', 'read this')
    ;(attachedMsg.data as { parts: unknown[] }).parts.push({
      type: 'file',
      mediaType: 'text/plain',
      url: 'file:///tmp/doc.txt',
      filename: 'doc.txt',
      providerMetadata: { cherry: { fileEntryId: 'fe-1' } }
    })
    mockGetPathToNode.mockReturnValue([fakeMsg('u1', 'user', 'older'), fakeMsg('a1', 'assistant', 'ok'), attachedMsg])
    maxMessagesOn(1)

    const { messages, prepared } = await makeHistory('u2')

    expect(messages.map((m) => m.id)).toEqual(['u2'])
    expect(prepared.models[0].request.retainedContext?.fileAttachments).toEqual([
      { fileEntryId: 'fe-1', handle: 'doc.txt', displayName: 'doc.txt' }
    ])
  })

  it('1g. a window ignores an older summary entirely and serves raw rows', async () => {
    // A summary covers everything up to its boundary, so serving one would
    // carry pre-window content back in and re-authorize the folded prefix.
    const foldedMsg = fakeMsg('u1', 'user', 'old question')
    ;(foldedMsg.data as { parts: unknown[] }).parts.push({
      type: 'file',
      mediaType: 'text/plain',
      url: 'file:///tmp/folded.txt',
      filename: 'folded.txt',
      providerMetadata: { cherry: { fileEntryId: 'fe-folded' } }
    })
    const boundary = fakeMsg('a1', 'assistant', 'old answer')
    boundary.compactionSummary = 'PRIOR_SUMMARY'
    mockGetPathToNode.mockReturnValue([foldedMsg, boundary, fakeMsg('u2', 'user', 'now what')])
    maxMessagesOn(1)

    const { messages, prepared } = await makeHistory('u2')

    // Everything before the window is gone — no synthetic summary row, and the
    // folded message's attachment leaves the read_file allow-list with it.
    expect(messages.map((m) => m.id)).toEqual(['u2'])
    expect(JSON.stringify(messages)).not.toContain('PRIOR_SUMMARY')
    expect(prepared.models[0].request.retainedContext?.fileAttachments).toEqual([])
  })

  it('1h. a window whose boundary row is inside it still serves raw, not the summary', async () => {
    // Even a boundary INSIDE the window is not served: its text still reaches
    // past the window. The raw rows go instead.
    const foldedMsg = fakeMsg('u1', 'user', 'old question')
    ;(foldedMsg.data as { parts: unknown[] }).parts.push({
      type: 'file',
      mediaType: 'text/plain',
      url: 'file:///tmp/folded.txt',
      filename: 'folded.txt',
      providerMetadata: { cherry: { fileEntryId: 'fe-folded' } }
    })
    const boundary = fakeMsg('a1', 'assistant', 'old answer')
    boundary.compactionSummary = 'PRIOR_SUMMARY'
    mockGetPathToNode.mockReturnValue([foldedMsg, boundary, fakeMsg('u2', 'user', 'now what')])
    // Last 2 = [a1, u2] opens on an assistant row, so the window extends back to u1.
    maxMessagesOn(2)

    const { messages, prepared } = await makeHistory('u2')

    expect(messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2'])
    expect(JSON.stringify(messages)).not.toContain('PRIOR_SUMMARY')
    expect(prepared.models[0].request.retainedContext?.fileAttachments).toEqual([
      { fileEntryId: 'fe-folded', handle: 'folded.txt', displayName: 'folded.txt' }
    ])
  })

  // Providers bill `input + max_tokens`, so a request that declares max_tokens
  // has that much less room for history. 4000 window − 2000 reserved = 2000 of
  // room, tripping at 1600 where the raw window would have waited until 3200.
  it('2a. an Anthropic-endpoint request folds against the room left after max_tokens', async () => {
    mockResolveEffectiveEndpoint.mockReturnValue({ endpointType: 'anthropic-messages' })
    const MID = 'token '.repeat(400) // 5 × 400 = 2000: under 3200, over 1600
    mockGetPathToNode.mockReturnValue(
      ['u1', 'a1', 'u2', 'a2', 'u3'].map((id, i) => fakeMsg(id, i % 2 === 0 ? 'user' : 'assistant', MID))
    )
    compressionOn()

    await makeHistory('u3', [DEFAULT_MODEL_ID], { maxOutputTokens: 2000 })

    expect(mockSummarizeModelMessages).toHaveBeenCalled()
  })

  // The trigger is configurable, and this lane must honour it — the in-loop hook
  // going green on its own would hide a regression here.
  it('2c. folds at a configured trigger the default would not have reached', async () => {
    const MID = 'token '.repeat(300) // 5 x 300 = 1500: under the default 3200, over 40%'s 1600... just under
    mockGetPathToNode.mockReturnValue(
      ['u1', 'a1', 'u2', 'a2', 'u3'].map((id, i) => fakeMsg(id, i % 2 === 0 ? 'user' : 'assistant', MID))
    )
    compressionOn(undefined, 30) // trigger = 30% of 4000 = 1200 < ~1500

    await makeHistory('u3')

    expect(mockSummarizeModelMessages).toHaveBeenCalled()
  })

  // The mirror of 2c: the same history under the default 80% trigger (3200)
  // stays untouched, so 2c is proving the setting and not just the history size.
  it('2c-bis. leaves that same history alone at the default trigger', async () => {
    const MID = 'token '.repeat(300)
    mockGetPathToNode.mockReturnValue(
      ['u1', 'a1', 'u2', 'a2', 'u3'].map((id, i) => fakeMsg(id, i % 2 === 0 ? 'user' : 'assistant', MID))
    )
    compressionOn()

    await makeHistory('u3')

    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
  })

  // The keep budget is a fraction of the TRIGGER (0.375x), not of the window
  // (the old 0.3x). Sized against the window it OVERSHOOTS a low trigger, and a
  // history that is over the trigger but still fits the budget leaves nothing to
  // snap: `planKeepBoundary` returns null and this lane silently stops folding
  // while the in-loop hook carries on alone.
  //
  // 5 x ~200 = ~1000 tokens at a 20% trigger on a 4000 window:
  //   trigger      = 800   → over budget, must fold
  //   keep (0.375x)= 300   → snaps a boundary, folds the head
  //   keep (old .3x window) = 1200 → whole history fits, boundary null, no fold
  it('2d. still snaps a keep boundary at a trigger below the old window-relative budget', async () => {
    const SMALL = 'token '.repeat(200)
    mockGetPathToNode.mockReturnValue(
      ['u1', 'a1', 'u2', 'a2', 'u3'].map((id, i) => fakeMsg(id, i % 2 === 0 ? 'user' : 'assistant', SMALL))
    )
    compressionOn(undefined, 20)

    await makeHistory('u3')

    expect(mockSummarizeModelMessages).toHaveBeenCalled()
    expect(mockSetCompactionSummary).toHaveBeenCalled()
  })

  // The same history on the same model, but an endpoint that puts no max_tokens
  // on the wire: nothing is billed, so the whole window stays available and the
  // fold that fires above must not fire here.
  it('2a-bis. an endpoint that sends no max_tokens keeps the whole window for history', async () => {
    const MID = 'token '.repeat(400)
    mockGetPathToNode.mockReturnValue(
      ['u1', 'a1', 'u2', 'a2', 'u3'].map((id, i) => fakeMsg(id, i % 2 === 0 ? 'user' : 'assistant', MID))
    )
    compressionOn()

    await makeHistory('u3', [DEFAULT_MODEL_ID], { maxOutputTokens: 2000 })

    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
  })

  it('2. over budget → summarize + persist on boundary + serve compacted view', async () => {
    // Use massive text so total tokens exceed 4000 * 0.8 = 3200 token trigger.
    // Each 'token '.repeat(700) block ≈ 700 tokens × 5 messages = 3500 > 3200.
    // keepBudget = floor(4000 * 0.3) = 1200.
    // Walking from tail: u3(700)≤1200 → keepStart=4; a2(700)→1400>1200 → stop.
    // keepIdx=4, boundary = recent[3] = a2.
    const BIG = 'token '.repeat(700)

    const path = [
      fakeMsg('u1', 'user', BIG),
      fakeMsg('a1', 'assistant', BIG),
      fakeMsg('u2', 'user', BIG),
      fakeMsg('a2', 'assistant', BIG),
      fakeMsg('u3', 'user', BIG)
    ]
    mockGetPathToNode.mockReturnValue(path)
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

  it('2b. folding an attachment-bearing message keeps the raw-path allow-list and adds the summary manifest', async () => {
    // Same over-budget setup as test 2, but the FOLDED first user message
    // carries a file part. Finding #2: the served view loses the part, so
    // scanning served messages downstream dropped read_file entirely.
    const BIG = 'token '.repeat(700)
    const attachedMsg = fakeMsg('u1', 'user', BIG)
    ;(attachedMsg.data as { parts: unknown[] }).parts.push({
      type: 'file',
      mediaType: 'text/plain',
      url: 'file:///tmp/log.txt',
      filename: 'log.txt',
      providerMetadata: { cherry: { fileEntryId: 'fe-1' } }
    })
    const path = [
      attachedMsg,
      fakeMsg('a1', 'assistant', BIG),
      fakeMsg('u2', 'user', BIG),
      fakeMsg('a2', 'assistant', BIG),
      fakeMsg('u3', 'user', BIG)
    ]
    mockGetPathToNode.mockReturnValue(path)
    compressionOn({})

    const { messages, prepared } = await makeHistory('u3')

    // Compaction folded u1 (its file part is gone from the served view) …
    expect(messages.map((m) => m.id)).not.toContain('u1')
    // … but the request carries the raw-path retained context …
    expect(prepared.models[0].request.retainedContext?.fileAttachments).toEqual([
      { fileEntryId: 'fe-1', handle: 'log.txt', displayName: 'log.txt' }
    ])
    expect(prepared.models[0].request.retainedContext?.persistedOutputPaths.size).toBe(0)
    // … and the served summary row tells the model the file is still readable.
    const summaryText = (messages[0].parts?.[0] as { text?: string })?.text ?? ''
    expect(summaryText).toContain('readable in full via the read_file tool: log.txt')
  })

  it('2c. summary-row bytes are a pure function of the boundary — live attachments never rewrite them', async () => {
    // Marker path (test-3 style, under budget, no summarizer): u1's attachment
    // is folded behind the marker; u2's is live (still a file part in the
    // served view). The manifest must list only the folded one, and the
    // summary-row text must be byte-identical whether or not the live
    // attachment exists — that is the provider-prefix-cache contract.
    const foldedMsg = fakeMsg('u1', 'user', 'old question')
    ;(foldedMsg.data as { parts: unknown[] }).parts.push({
      type: 'file',
      mediaType: 'text/plain',
      url: 'file:///tmp/folded.txt',
      filename: 'folded.txt',
      providerMetadata: { cherry: { fileEntryId: 'fe-1' } }
    })
    const liveMsg = fakeMsg('u2', 'user', 'new question')
    ;(liveMsg.data as { parts: unknown[] }).parts.push({
      type: 'file',
      mediaType: 'text/plain',
      url: 'file:///tmp/live.txt',
      filename: 'live.txt',
      providerMetadata: { cherry: { fileEntryId: 'fe-2' } }
    })
    const pathWithLive = [foldedMsg, fakeMsg('a1', 'assistant', 'old answer', 'PRIOR SUMMARY'), liveMsg]
    const pathWithoutLive = [
      foldedMsg,
      fakeMsg('a1', 'assistant', 'old answer', 'PRIOR SUMMARY'),
      fakeMsg('u2', 'user', 'new question')
    ]
    compressionOn()

    mockGetPathToNode.mockReturnValue(pathWithLive)
    const { messages: withLive, prepared } = await makeHistory('u2')
    mockGetPathToNode.mockReturnValue(pathWithoutLive)
    const { messages: withoutLive } = await makeHistory('u2')

    const summaryTextOf = (msgs: typeof withLive) => (msgs[0].parts?.[0] as { text?: string })?.text ?? ''
    expect(summaryTextOf(withLive)).toContain('readable in full via the read_file tool: folded.txt')
    expect(summaryTextOf(withLive)).not.toContain('live.txt')
    expect(summaryTextOf(withLive)).toBe(summaryTextOf(withoutLive))
    // Capability side still covers BOTH attachments (folded + live).
    expect(prepared.models[0].request.retainedContext?.fileAttachments.map((a) => a.handle)).toEqual([
      'folded.txt',
      'live.txt'
    ])
  })

  // `Model.contextWindow` is optional; an `as number` cast made every derived
  // budget `NaN`, and `estimate <= NaN` is false — so the trigger looked
  // permanently exceeded while `planKeepBoundary(NaN)` had no budget to keep
  // against. Skip compaction instead, and never summarize against a NaN budget.
  it('2f. skips durable compaction when no model declares a contextWindow', async () => {
    const path = [
      fakeMsg('u1', 'user', 'x'.repeat(40_000)),
      fakeMsg('a1', 'assistant', 'y'.repeat(40_000)),
      fakeMsg('u2', 'user', 'latest')
    ]
    mockGetPathToNode.mockReturnValue(path)
    compressionOn()

    const { messages } = await makeHistory('u2', [DEFAULT_MODEL_ID], { contextWindow: undefined })

    expect(mockSummarizeModelMessages).not.toHaveBeenCalled()
    expect(mockSetCompactionSummary).not.toHaveBeenCalled()
    // Nothing folded — the whole path is still served.
    expect(messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2'])
  })

  it('2g. budgets the summarize call by the compressor window, not the chat window', async () => {
    // 20k chat window → trigger 16k tokens; 5 × 4k-token blocks = 20k clears it.
    const BIG = 'token '.repeat(4_000)
    const path = [
      fakeMsg('u1', 'user', BIG),
      fakeMsg('a1', 'assistant', BIG),
      fakeMsg('u2', 'user', BIG),
      fakeMsg('a2', 'assistant', BIG),
      fakeMsg('u3', 'user', BIG)
    ]
    mockGetPathToNode.mockReturnValue(path)
    // Explicit 8k compressor: the summarize request must fit ITS window.
    // Budgeting by the 20k chat window would allocate ~17.7k and overflow it.
    compressionOn({ languageModel: {}, contextWindow: 8_000 })

    await makeHistory('u3', [DEFAULT_MODEL_ID], { contextWindow: 20_000 })

    expect(mockSummarizeModelMessages).toHaveBeenCalled()
    const opts = mockSummarizeModelMessages.mock.calls[0][2]
    expect(opts.maxOutputTokens + opts.maxInputTokens).toBeLessThan(8_000)
  })

  // Turn-start compaction runs BEFORE the model stream opens, so without a
  // progress event the turn looks stalled for the whole summarize round-trip.
  // It must also settle on every exit, or the spinner outlives the work.
  it('2h. brackets the turn-start fold with compacting → done anchor chunks', async () => {
    const BIG = 'token '.repeat(700)
    mockGetPathToNode.mockReturnValue([
      fakeMsg('u1', 'user', BIG),
      fakeMsg('a1', 'assistant', BIG),
      fakeMsg('u2', 'user', BIG),
      fakeMsg('a2', 'assistant', BIG),
      fakeMsg('u3', 'user', BIG)
    ])
    compressionOn()

    const { prepared } = await makeHistory('u3')
    void prepared
    const anchors = capturedChunks.filter((c) => c.type === 'data-compaction-anchor')
    expect(anchors.map((c) => c.data.status)).toEqual(['compacting', 'done'])
    // One fold → one id, so the done event REPLACES the spinner rather than
    // stacking two anchors. (Separate folds get separate ids — see the in-loop suite.)
    expect(new Set(anchors.map((c) => c.id)).size).toBe(1)
    expect(anchors.every((c) => c.data.phase === 'turn-start')).toBe(true)
  })

  const fiveBigTurns = () => {
    const BIG = 'token '.repeat(700)
    mockGetPathToNode.mockReturnValue([
      fakeMsg('u1', 'user', BIG),
      fakeMsg('a1', 'assistant', BIG),
      fakeMsg('u2', 'user', BIG),
      fakeMsg('a2', 'assistant', BIG),
      fakeMsg('u3', 'user', BIG)
    ])
  }

  it('2i. settles the anchor as skipped when the summarizer returns nothing (no false marker)', async () => {
    fiveBigTurns()
    compressionOn()
    mockSummarizeModelMessages.mockResolvedValueOnce('')

    await makeHistory('u3')
    const anchors = capturedChunks.filter((c) => c.type === 'data-compaction-anchor')
    expect(anchors.map((c) => c.data.status)).toEqual(['compacting', 'skipped'])
  })

  it('2i2. settles the anchor as skipped when the summarizer throws', async () => {
    fiveBigTurns()
    compressionOn()
    mockSummarizeModelMessages.mockRejectedValueOnce(new Error('summarizer failed'))

    await makeHistory('u3')
    const anchors = capturedChunks.filter((c) => c.type === 'data-compaction-anchor')
    expect(anchors.map((c) => c.data.status)).toEqual(['compacting', 'skipped'])
  })

  it('2d. blobs of compacted-away tool outputs stay on the request allow-list', async () => {
    // a1 carries a persisted tool-output envelope and is folded behind a2's
    // marker — its blob path must still reach retainedContext (fs_read
    // allow-list), even though the part is gone from the served view.
    const toolMsg = fakeMsg('a1', 'assistant', 'ran a tool')
    ;(toolMsg.data as { parts: unknown[] }).parts.push({
      type: 'tool-run_cmd',
      toolCallId: 'call-1',
      state: 'output-available',
      input: {},
      output: {
        $persistedToolOutput: {
          fileEntryId: 'fe-blob',
          vfsFilename: 'vfs_0123456789abcdef.txt',
          head: 'head',
          tail: 'tail',
          totalChars: 100_000,
          totalLines: 2_000,
          shape: 'text'
        }
      }
    })
    const path = [
      fakeMsg('u1', 'user', 'old question'),
      toolMsg,
      fakeMsg('a2', 'assistant', 'old answer', 'PRIOR SUMMARY'),
      fakeMsg('u2', 'user', 'latest question')
    ]
    mockGetPathToNode.mockReturnValue(path)
    compressionOn()

    const { messages, prepared } = await makeHistory('u2')

    expect(messages.map((m) => m.id)).not.toContain('a1')
    const paths = [...(prepared.models[0].request.retainedContext?.persistedOutputPaths ?? [])]
    expect(paths).toEqual(['/blobs/fe-blob.txt'])
    // …and the summary NAMES it. Without that the model held fs_read with no
    // legal argument — the marker carrying the path is gone from the view.
    expect(messages[0].parts?.[0]).toMatchObject({
      text: expect.stringContaining('/blobs/fe-blob.txt')
    })
  })

  // Scoping both manifests to the folded prefix keeps the row a pure function
  // of the boundary, so provider prefix caches survive.
  it('2d-bis. summary text is byte-identical when nothing is folded behind the boundary', async () => {
    const path = [
      fakeMsg('u1', 'user', 'old question'),
      fakeMsg('a1', 'assistant', 'old answer', 'PRIOR SUMMARY'),
      fakeMsg('u2', 'user', 'latest question')
    ]
    mockGetPathToNode.mockReturnValue(path)
    compressionOn()

    const { messages } = await makeHistory('u2')

    const text = (messages[0].parts?.[0] as { text?: string })?.text ?? ''
    expect(text).toContain('PRIOR SUMMARY')
    expect(text).not.toContain('read_file tool')
    expect(text).not.toContain('fs_read tool')
  })

  // The invariant both review findings add up to: everything fs_read is allowed
  // to read must be nameable from the served prompt.
  it('2d-ter. every allow-listed persisted path is visible in the served prompt', async () => {
    const toolMsg = fakeMsg('a1', 'assistant', 'ran a tool')
    ;(toolMsg.data as { parts: unknown[] }).parts.push({
      type: 'tool-run_cmd',
      toolCallId: 'call-1',
      state: 'output-available',
      input: {},
      output: {
        $persistedToolOutput: {
          fileEntryId: 'fe-blob',
          vfsFilename: 'vfs_0123456789abcdef.txt',
          head: 'head',
          tail: 'tail',
          totalChars: 100_000,
          totalLines: 2_000,
          shape: 'text'
        }
      }
    })
    mockGetPathToNode.mockReturnValue([
      fakeMsg('u1', 'user', 'old question'),
      toolMsg,
      fakeMsg('a2', 'assistant', 'old answer', 'PRIOR SUMMARY'),
      fakeMsg('u2', 'user', 'latest question')
    ])
    compressionOn()

    const { messages, prepared } = await makeHistory('u2')

    const served = JSON.stringify(messages)
    for (const p of prepared.models[0].request.retainedContext?.persistedOutputPaths ?? []) {
      expect(served).toContain(p)
    }
  })

  it("2e. threads the assistant's context-settings override into the request-settings resolver (P2-D)", async () => {
    const OVERRIDE = { truncateThreshold: 4000, compress: { enabled: false } }
    const { resolveAssistantModelId } = await import('../modelResolution')
    // Once: prepareDispatch calls it a single time; reverts to the undefined-assistant
    // factory default so later tests are unaffected.
    vi.mocked(resolveAssistantModelId).mockReturnValueOnce({
      assistantId: 'asst-1',
      defaultModelId: 'openai::gpt-4o' as UniqueModelId
    })
    mockGetAssistantById.mockReturnValue({
      id: 'asst-1',
      name: 'A',
      emoji: '🤖',
      settings: { contextSettings: OVERRIDE }
    })
    mockGetPathToNode.mockReturnValue([fakeMsg('u1', 'user', 'hello')])
    compressionOn()

    await makeHistory('u1')

    // resolveCompactedHistory forwards the override as the resolver's 2nd arg.
    expect(mockResolveRequestContextSettings).toHaveBeenCalledWith(expect.anything(), OVERRIDE)
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
    mockGetPathToNode.mockReturnValue(path)
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
    mockGetPathToNode.mockReturnValue(path)
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
    // keepBudget=floor(10000*0.3)=3000. walk from tail: u3(1000)→1000,ks=4; a2(2000)→3000; u2(2000)→5000>3000 → stop.
    // keepStart=4, keepIdx=4 (not null, not 0). boundary=recent[3]=a2. ✓ (test asserts only that it triggered)
    // NOTE: the derivation lines above predate KEEP_BUDGET_RATIO=0.3 (they show the old 0.5 math); the fixture still
    // triggers under 0.3 — only the boundary moved a1→a2, which this test does not assert.

    const MED = 'word '.repeat(2000)
    const TRAIL = 'word '.repeat(1000)

    const path = [
      fakeMsg('u1', 'user', 'tiny question'),
      fakeMsgWithContextTokens('a1', 'assistant', 'ok', 7900),
      fakeMsg('u2', 'user', MED),
      fakeMsg('a2', 'assistant', MED),
      fakeMsg('u3', 'user', TRAIL)
    ]
    mockGetPathToNode.mockReturnValue(path)
    compressionOn({})

    // Use a model with contextWindow=10000
    const { resolveModels } = await import('../modelResolution')
    const MODEL_ID_10K = createUniqueModelId('openai', 'gpt-4o-10k')
    vi.mocked(resolveModels).mockReturnValueOnce([makeModel(MODEL_ID_10K, 10_000)])
    // Also patch createUserMessageWithPlaceholders for this one-off model id
    const { messageService } = await import('@main/data/services/MessageService')
    vi.mocked(messageService.createUserMessageWithPlaceholders).mockReturnValueOnce({
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
    mockGetPathToNode.mockReturnValue(path)
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

// ---------------------------------------------------------------------------
// Cross-layer interaction: turn-start (durable) vs in-loop compaction.
//
// Two compaction mechanisms run at different altitudes:
//   • turn-start  — resolveCompactedHistory, on cherry ROWS, runs FIRST and
//     serves a history that is ≤ 0.8×window BY CONSTRUCTION.
//   • in-loop     — inLoopCompactionFeature.prepareStep, on ModelMessage[], the
//     SDK's about-to-send prompt; fires only when estimate ≥ 0.8×window.
//
// The invariant: they do NOT summarize the same slice twice. Because turn-start
// already pulled the served history under 0.8×window, the in-loop hook is a
// NO-OP at step 0 (Assertion A) and fires ONLY once the agent loop GROWS the
// prompt past the trigger mid-turn (Assertion B). When it fires mid-loop, the
// turn-start summary sits in the prefix it folds while the freshly-grown turns
// are its kept tail — disjoint ranges, not a redundant re-summary.
//
// Altitude: TRUE integration. The served history is the real output of
// resolveCompactedHistory (driven via prepareDispatch / makeHistory), bridged to
// ModelMessage[] with the real `ai` convertToModelMessages — the same conversion
// the Agent applies downstream — then fed to the real in-loop hook.
// ---------------------------------------------------------------------------

/** tokenx estimate of a ModelMessage, mirroring inLoopCompaction's own estimator. */
function estimateMessageTokens(message: { content: unknown }): number {
  const { content } = message
  if (typeof content === 'string') return estimateTokenCount(content)
  const text = (content as Array<Record<string, unknown>>)
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : JSON.stringify(part)))
    .join('\n')
  return estimateTokenCount(text)
}
const estimateModelMessages = (messages: Array<{ content: unknown }>) =>
  messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)

/** A scope shaped like the real RequestScope, sized to the turn-start window. */
function inLoopScope(contextWindow: number) {
  return {
    request: { chatId: 'topic-1' },
    model: { id: 'openai::gpt-4o', contextWindow },
    // Read only to pick the per-dialect media cost table (`resolveModelTokenDialect`).
    provider: { id: 'openai', defaultChatEndpoint: 'openai-chat-completions', endpointConfigs: {} },
    contextSettings: { enabled: true, compress: { enabled: true, thresholdPercent: 80 } },
    compressionModel: { id: 'compression-model' }
  } as any
}

describe('in-loop vs turn-start compaction — no double-compact', () => {
  const WINDOW = 4000 // makeModel default; trigger = floor(4000 * 0.8) = 3200
  // 700-token blocks: 5 rows = 3500 > 3200 → turn-start compaction triggers.
  const BIG = 'token '.repeat(700)

  beforeEach(() => {
    vi.clearAllMocks()
    capturedChunks = []
    mockSummarizeModelMessages.mockResolvedValue('SUMMARY_TEXT')
    // Default: the compactor returns a DISTINCT compacted array (so the hook would emit an
    // override IF it fired). Assertion A asserts it is never called regardless.
    mockCompactModelMessages.mockImplementation(async () => [{ role: 'user' as const, content: 'COMPACTED' }])
  })

  /** Drive turn-start compaction once and return the served history as ModelMessage[]. */
  async function servedTurnStartHistory() {
    const path = [
      fakeMsg('u1', 'user', BIG),
      fakeMsg('a1', 'assistant', BIG),
      fakeMsg('u2', 'user', BIG),
      fakeMsg('a2', 'assistant', BIG),
      fakeMsg('u3', 'user', BIG)
    ]
    mockGetPathToNode.mockReturnValue(path)
    compressionOn({})

    const { messages: servedRows } = await makeHistory('u3')

    // Turn-start fired exactly once and served the compacted view: [summary(a2), u3].
    expect(mockSummarizeModelMessages).toHaveBeenCalledTimes(1)
    expect(servedRows[0].id).toBe('compaction:a2')
    expect(servedRows[1].role).toBe('user')

    // Bridge: served CherryUIMessage[] → ModelMessage[] (real conversion).
    const modelMessages = await convertToModelMessages(servedRows as any)
    return { servedRows, modelMessages }
  }

  it('A: turn-start output is a no-op for the in-loop hook at step 0 (no double-compact)', async () => {
    const { modelMessages } = await servedTurnStartHistory()

    // The served history is under 0.8×window by construction.
    expect(estimateModelMessages(modelMessages)).toBeLessThan(Math.floor(WINDOW * 0.8))

    const prepareStep = inLoopCompactionFeature.contributeHooks!(inLoopScope(WINDOW)).prepareStep!
    const result = await prepareStep({ messages: modelMessages } as any)

    // Hook is a no-op: no override, and the compactor was NOT invoked.
    expect(result).toBeUndefined()
    expect(mockCompactModelMessages).not.toHaveBeenCalled()
    // Net across both layers: turn-start summarized once, in-loop compacted zero.
    expect(mockSummarizeModelMessages).toHaveBeenCalledTimes(1)
  })

  it('B: in-loop fires only after mid-loop growth crosses 0.8×window', async () => {
    const { modelMessages } = await servedTurnStartHistory()

    // Simulate the agent loop accumulating output: append an assistant turn plus a
    // tool result, large enough to tip the prompt over the 3200-token trigger.
    const grownPrompt = [
      ...modelMessages,
      { role: 'assistant' as const, content: [{ type: 'text', text: 'word '.repeat(1500) }] },
      {
        role: 'tool' as const,
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'search',
            output: { type: 'text', value: 'word '.repeat(1500) }
          }
        ]
      }
    ] as any[]
    expect(estimateModelMessages(grownPrompt)).toBeGreaterThanOrEqual(Math.floor(WINDOW * 0.8))

    const prepareStep = inLoopCompactionFeature.contributeHooks!(inLoopScope(WINDOW)).prepareStep!
    const result = await prepareStep({ messages: grownPrompt } as any)

    // Now it fires: the compactor called exactly once with keepRecentTurns ≥ 1,
    // and the hook returns the override with the mocked compacted messages.
    expect(mockCompactModelMessages).toHaveBeenCalledTimes(1)
    const [passedMessages, , options] = mockCompactModelMessages.mock.calls[0]
    expect(options.keepRecentTurns).toBeGreaterThanOrEqual(1)
    expect(result).toEqual({ messages: [{ role: 'user', content: 'COMPACTED' }] })

    // Disjointness: the prompt handed to the compactor carries the turn-start summary in its
    // OLD prefix (position 0, to be folded), while the appended turns — what
    // keepRecentTurns retains — are the grown tail. Different ranges, not a
    // re-summary of the identical turn-start slice.
    expect(passedMessages[0]).toEqual(modelMessages[0]) // turn-start summary, folded into prefix
    expect(passedMessages.at(-1).role).toBe('tool') // grown tail, kept verbatim
    expect(passedMessages.length).toBe(grownPrompt.length)
  })
})
