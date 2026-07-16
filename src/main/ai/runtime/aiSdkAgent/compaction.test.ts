import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSessionRuntimeStateTable } from '@data/db/schemas/agentSessionRuntimeState'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionRuntimeStateService } from '@data/services/AgentSessionRuntimeStateService'
import type { MessageData } from '@shared/data/types/message'
import { setupTestDatabase } from '@test-helpers/db'
import type { ModelMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  agentParams: [] as Array<Record<string, unknown>>
}))

vi.mock('../aiSdk', () => ({
  Agent: class {
    constructor(params: Record<string, unknown>) {
      mocks.agentParams.push(params)
    }
    generate = mocks.generate
  }
}))

const { compactSession, COMPACTION_RETAIN_TAIL_MESSAGES } = await import('./compaction')

const SESSION_ID = 'session-compact'
const SDK_CONFIG = { providerId: 'openai', providerSettings: {}, modelId: 'gpt-test' } as never
const MODEL_ID = 'openai::gpt-test' as never

describe('compactSession', () => {
  const dbh = setupTestDatabase()

  type SeedRow = { id: string; createdAt: number; role?: 'user' | 'assistant'; text?: string }

  async function seedRows(rows: SeedRow[]) {
    await dbh.db.insert(agentSessionMessageTable).values(
      rows.map((row) => ({
        id: row.id,
        sessionId: SESSION_ID,
        role: row.role ?? 'assistant',
        data: { parts: [{ type: 'text' as const, text: row.text ?? `content of ${row.id}` }] } as MessageData,
        status: 'success' as const,
        createdAt: row.createdAt,
        updatedAt: row.createdAt
      }))
    )
  }

  /** 3 exchanges + the boundary user row: with a tail of 4, the prefix is (u1, a1). */
  async function seedThreeExchanges() {
    await seedRows([
      { id: 'u1', createdAt: 100, role: 'user', text: 'first question' },
      { id: 'a1', createdAt: 200, text: 'first answer' },
      { id: 'u2', createdAt: 300, role: 'user', text: 'second question' },
      { id: 'a2', createdAt: 400, text: 'second answer' },
      { id: 'u3', createdAt: 500, role: 'user', text: 'third question' },
      { id: 'a3', createdAt: 600, text: 'third answer' },
      { id: 'u4', createdAt: 700, role: 'user', text: 'current prompt' }
    ])
  }

  function summarizerInputText(callIndex = 0): string {
    const { messages } = mocks.generate.mock.calls[callIndex][0] as { messages: ModelMessage[] }
    return JSON.stringify(messages)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.agentParams.length = 0
    mocks.generate.mockResolvedValue({ text: 'THE SUMMARY', usage: {} })
    await dbh.db.insert(agentWorkspaceTable).values({
      id: 'ws-1',
      name: 'ws-1',
      path: '/tmp/ws-1',
      type: 'user',
      orderKey: 'w0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: SESSION_ID,
      name: 'Session',
      orderKey: 'a0',
      workspaceId: 'ws-1'
    })
  })

  it('summarizes the prefix, retains the tail verbatim, and persists the checkpoint', async () => {
    await seedThreeExchanges()

    const anchor = await compactSession({
      sessionId: SESSION_ID,
      boundaryMessageId: 'u4',
      trigger: 'manual',
      sdkConfig: SDK_CONFIG,
      modelId: MODEL_ID,
      preTokens: 9000
    })

    // Summarizer saw the prefix but never the retained tail or the boundary prompt.
    const input = summarizerInputText()
    expect(input).toContain('first question')
    expect(input).toContain('first answer')
    expect(input).not.toContain('second question')
    expect(input).not.toContain('third answer')
    expect(input).not.toContain('current prompt')

    // Tools-off one-shot with the dedicated summarization system prompt.
    expect(mocks.agentParams[0]).toMatchObject({ tools: {}, modelId: 'gpt-test' })
    expect(mocks.agentParams[0].system).toContain('compacting')

    const state = agentSessionRuntimeStateService.getState(SESSION_ID, 'ai-sdk')
    expect(state).toMatchObject({
      compactedThroughMessageId: 'a1',
      summary: 'THE SUMMARY',
      compactionModelId: MODEL_ID
    })
    expect(state!.summaryTokenCount).toBeGreaterThan(0)
    expect(state!.sourceTokenCount).toBeGreaterThan(0)

    expect(anchor).toMatchObject({ trigger: 'manual', preTokens: 9000 })
    expect(anchor!.postTokens).toBeGreaterThan(0)
    expect(anchor!.durationMs).toBeGreaterThanOrEqual(0)
    expect(Date.parse(anchor!.completedAt)).not.toBeNaN()
  })

  it('threads the /compact focus into the summarization instruction', async () => {
    await seedThreeExchanges()

    await compactSession({
      sessionId: SESSION_ID,
      boundaryMessageId: 'u4',
      trigger: 'manual',
      focus: 'the database migration',
      sdkConfig: SDK_CONFIG,
      modelId: MODEL_ID
    })

    expect(summarizerInputText()).toContain('the database migration')
  })

  it('is a no-op (null, no write, no model call) when only the tail exists', async () => {
    await seedRows([
      { id: 'u1', createdAt: 100, role: 'user' },
      { id: 'a1', createdAt: 200 },
      { id: 'u2', createdAt: 300, role: 'user' },
      { id: 'a2', createdAt: 400 },
      { id: 'u3', createdAt: 500, role: 'user' }
    ])

    const anchor = await compactSession({
      sessionId: SESSION_ID,
      boundaryMessageId: 'u3',
      trigger: 'auto',
      sdkConfig: SDK_CONFIG,
      modelId: MODEL_ID
    })

    expect(anchor).toBeNull()
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(await dbh.db.select().from(agentSessionRuntimeStateTable)).toHaveLength(0)
  })

  it.each([
    ['the summarization request fails', () => mocks.generate.mockRejectedValue(new Error('provider down'))],
    ['the model returns an empty summary', () => mocks.generate.mockResolvedValue({ text: '   ', usage: {} })]
  ])('preserves the previous checkpoint when %s', async (_name, arm) => {
    await seedThreeExchanges()
    agentSessionRuntimeStateService.saveState({
      sessionId: SESSION_ID,
      runtimeType: 'ai-sdk',
      compactedThroughMessageId: 'u1',
      summary: 'prior summary',
      compactionModelId: MODEL_ID
    })
    arm()

    await expect(
      compactSession({
        sessionId: SESSION_ID,
        boundaryMessageId: 'u4',
        trigger: 'manual',
        sdkConfig: SDK_CONFIG,
        modelId: MODEL_ID
      })
    ).rejects.toThrow()

    expect(agentSessionRuntimeStateService.getState(SESSION_ID, 'ai-sdk')).toMatchObject({
      compactedThroughMessageId: 'u1',
      summary: 'prior summary'
    })
  })

  it('folds the prior summary forward on re-compaction and advances the anchor', async () => {
    await seedThreeExchanges()
    agentSessionRuntimeStateService.saveState({
      sessionId: SESSION_ID,
      runtimeType: 'ai-sdk',
      compactedThroughMessageId: 'a1',
      summary: 'earlier summary of exchange one',
      compactionModelId: MODEL_ID
    })
    // Two more rows so the post-anchor window (u2..a3 plus these) leaves a
    // non-empty prefix after tail retention.
    await seedRows([
      { id: 'u5', createdAt: 800, role: 'user', text: 'fifth question' },
      { id: 'a5', createdAt: 900, text: 'fifth answer' },
      { id: 'u6', createdAt: 1000, role: 'user', text: 'sixth prompt' }
    ])

    const anchor = await compactSession({
      sessionId: SESSION_ID,
      boundaryMessageId: 'u6',
      trigger: 'auto',
      sdkConfig: SDK_CONFIG,
      modelId: MODEL_ID
    })

    // Post-anchor rows: u2 a2 u3 a3 u4 u5 a5 → prefix (u2, a2, u3), tail (a3, u4, u5, a5).
    const input = summarizerInputText()
    expect(input).toContain('earlier summary of exchange one')
    expect(input).toContain('second question')
    expect(input).toContain('third question')
    expect(input).not.toContain('first question') // pre-anchor rows come back only via the summary
    expect(input).not.toContain('fifth question')

    expect(anchor).not.toBeNull()
    expect(agentSessionRuntimeStateService.getState(SESSION_ID, 'ai-sdk')).toMatchObject({
      compactedThroughMessageId: 'u3',
      summary: 'THE SUMMARY'
    })
  })

  it('never feeds persisted /compact command rows to the summarizer', async () => {
    await seedRows([
      { id: 'u1', createdAt: 100, role: 'user', text: 'first question' },
      { id: 'c1', createdAt: 150, role: 'user', text: '/compact focus on tests' },
      { id: 'a1', createdAt: 200, text: 'first answer' },
      { id: 'u2', createdAt: 300, role: 'user', text: 'second question' },
      { id: 'a2', createdAt: 400, text: 'second answer' },
      { id: 'u3', createdAt: 500, role: 'user', text: 'third question' },
      { id: 'a3', createdAt: 600, text: 'third answer' },
      { id: 'u4', createdAt: 700, role: 'user', text: 'current prompt' }
    ])

    await compactSession({
      sessionId: SESSION_ID,
      boundaryMessageId: 'u4',
      trigger: 'manual',
      sdkConfig: SDK_CONFIG,
      modelId: MODEL_ID
    })

    const input = summarizerInputText()
    expect(input).toContain('first question')
    expect(input).not.toContain('focus on tests')
  })

  it('exposes the documented tail ceiling', () => {
    expect(COMPACTION_RETAIN_TAIL_MESSAGES).toBe(4)
  })

  it('discards the checkpoint when a summarized row is deleted during the model call', async () => {
    await seedThreeExchanges()
    const { agentSessionMessageService } = await import('@data/services/AgentSessionMessageService')
    // The delete lands while `generate` is in flight — after the row snapshot,
    // before the checkpoint write. Its same-transaction invalidation must win.
    mocks.generate.mockImplementation(async () => {
      agentSessionMessageService.deleteSessionMessage(SESSION_ID, 'a1')
      return { text: 'SUMMARY EMBEDDING DELETED CONTENT', usage: {} }
    })

    await expect(
      compactSession({
        sessionId: SESSION_ID,
        boundaryMessageId: 'u4',
        trigger: 'manual',
        sdkConfig: SDK_CONFIG,
        modelId: MODEL_ID
      })
    ).rejects.toThrow('changed while the summary was generating')

    expect(await dbh.db.select().from(agentSessionRuntimeStateTable)).toHaveLength(0)
  })

  it('discards the checkpoint when the folded prior state is invalidated during the model call', async () => {
    await seedThreeExchanges()
    agentSessionRuntimeStateService.saveState({
      sessionId: SESSION_ID,
      runtimeType: 'ai-sdk',
      compactedThroughMessageId: 'a1',
      summary: 'prior summary',
      compactionModelId: MODEL_ID
    })
    await seedRows([
      { id: 'u5', createdAt: 800, role: 'user', text: 'fifth question' },
      { id: 'a5', createdAt: 900, text: 'fifth answer' },
      { id: 'u6', createdAt: 1000, role: 'user', text: 'sixth prompt' }
    ])
    const { agentSessionMessageService } = await import('@data/services/AgentSessionMessageService')
    // Deleting a TAIL row (not summarized) still invalidates the prior state
    // whose summary we folded in — the guard must catch that too.
    mocks.generate.mockImplementation(async () => {
      agentSessionMessageService.deleteSessionMessage(SESSION_ID, 'a5')
      return { text: 'SUMMARY FOLDING A DEAD PRIOR STATE', usage: {} }
    })

    await expect(
      compactSession({
        sessionId: SESSION_ID,
        boundaryMessageId: 'u6',
        trigger: 'auto',
        sdkConfig: SDK_CONFIG,
        modelId: MODEL_ID
      })
    ).rejects.toThrow('changed while the summary was generating')

    expect(await dbh.db.select().from(agentSessionRuntimeStateTable)).toHaveLength(0)
  })
})
