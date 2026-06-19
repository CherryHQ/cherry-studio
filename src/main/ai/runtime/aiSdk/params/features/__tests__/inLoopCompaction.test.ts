import type { ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

const compactModelMessages = vi.fn()
vi.mock('@context-chef/ai-sdk-middleware', () => ({
  compactModelMessages: (...args: unknown[]) => compactModelMessages(...args)
}))
vi.mock('@main/ai/agentSession/topic', () => ({
  isAgentSessionTopic: (id: string) => id.startsWith('agent-session:')
}))
vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: { hasTopic: (id: string) => id.startsWith('temp:') }
}))

import { computeKeepRecentTurns, inLoopCompactionFeature } from '../inLoopCompaction'

const CONTEXT_WINDOW = 100_000
const COMPRESSION_MODEL = { id: 'compression-model' } as any

const scope = (overrides: {
  chatId?: string
  contextWindow?: number
  enabled?: boolean
  compressEnabled?: boolean
  compressionModel?: unknown
}) =>
  ({
    request: { chatId: overrides.chatId },
    model: { id: 'prov::model', contextWindow: overrides.contextWindow },
    contextSettings: {
      enabled: overrides.enabled ?? true,
      compress: { enabled: overrides.compressEnabled ?? true }
    },
    compressionModel: 'compressionModel' in overrides ? overrides.compressionModel : COMPRESSION_MODEL
  }) as any

/** A single text user message whose tokenx estimate is ~`approxTokens`. */
const userMessage = (approxTokens: number): ModelMessage => ({
  role: 'user',
  content: 'word '.repeat(approxTokens)
})

describe('inLoopCompactionFeature', () => {
  // --- applies ---

  it('applies for a persistent chat with contextWindow > 0, compression enabled, and a model', () => {
    expect(inLoopCompactionFeature.applies?.(scope({ chatId: 'topic-1', contextWindow: CONTEXT_WINDOW }))).toBe(true)
  })

  it('does not apply when chatId is missing', () => {
    expect(inLoopCompactionFeature.applies?.(scope({ contextWindow: CONTEXT_WINDOW }))).toBe(false)
  })

  it('does not apply when contextWindow is 0', () => {
    expect(inLoopCompactionFeature.applies?.(scope({ chatId: 'topic-1', contextWindow: 0 }))).toBe(false)
  })

  it('does not apply when contextWindow is undefined', () => {
    expect(inLoopCompactionFeature.applies?.(scope({ chatId: 'topic-1', contextWindow: undefined }))).toBe(false)
  })

  it('does not apply for agent-session topics', () => {
    expect(
      inLoopCompactionFeature.applies?.(scope({ chatId: 'agent-session:s1', contextWindow: CONTEXT_WINDOW }))
    ).toBe(false)
  })

  it('does not apply for temporary-chat topics', () => {
    expect(inLoopCompactionFeature.applies?.(scope({ chatId: 'temp:t1', contextWindow: CONTEXT_WINDOW }))).toBe(false)
  })

  it('does not apply when context-build is disabled', () => {
    expect(
      inLoopCompactionFeature.applies?.(scope({ chatId: 'topic-1', contextWindow: CONTEXT_WINDOW, enabled: false }))
    ).toBe(false)
  })

  it('does not apply when compression is disabled', () => {
    expect(
      inLoopCompactionFeature.applies?.(
        scope({ chatId: 'topic-1', contextWindow: CONTEXT_WINDOW, compressEnabled: false })
      )
    ).toBe(false)
  })

  it('does not apply when there is no compression model', () => {
    expect(
      inLoopCompactionFeature.applies?.(
        scope({ chatId: 'topic-1', contextWindow: CONTEXT_WINDOW, compressionModel: null })
      )
    ).toBe(false)
  })

  // --- contributeHooks: prepareStep ---

  const getPrepareStep = () => {
    const hooks = inLoopCompactionFeature.contributeHooks!(scope({ chatId: 'topic-1', contextWindow: CONTEXT_WINDOW }))
    expect(hooks.prepareStep).toBeTypeOf('function')
    return hooks.prepareStep!
  }

  it('returns no override and does not compact when the prompt is below 80% of the window', async () => {
    compactModelMessages.mockClear()
    const prepareStep = getPrepareStep()
    // trigger = 0.8 * 100_000 = 80_000; a small prompt stays well under it.
    const messages = [userMessage(100)]
    const result = await prepareStep({ messages } as any)
    expect(result).toBeUndefined()
    expect(compactModelMessages).not.toHaveBeenCalled()
  })

  it('compacts and returns { messages } when the prompt reaches 80% of the window', async () => {
    compactModelMessages.mockClear()
    const compacted = [userMessage(10)]
    compactModelMessages.mockResolvedValue(compacted)
    const prepareStep = getPrepareStep()
    // ~90k tokens (> trigger of 80k).
    const messages = [userMessage(90_000)]
    const result = await prepareStep({ messages } as any)
    expect(compactModelMessages).toHaveBeenCalledOnce()
    expect(compactModelMessages).toHaveBeenCalledWith(messages, COMPRESSION_MODEL, {
      keepRecentTurns: expect.any(Number)
    })
    expect(result).toEqual({ messages: compacted })
  })

  it('returns no override when compactModelMessages returns the same reference (no-op)', async () => {
    compactModelMessages.mockClear()
    const prepareStep = getPrepareStep()
    const messages = [userMessage(90_000)]
    // chef returns the input reference unchanged on a no-op.
    compactModelMessages.mockResolvedValue(messages)
    const result = await prepareStep({ messages } as any)
    expect(compactModelMessages).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })

  it('passes at least one recent turn to keep when over budget', async () => {
    compactModelMessages.mockClear()
    compactModelMessages.mockResolvedValue([userMessage(10)])
    const prepareStep = getPrepareStep()
    const messages = [userMessage(90_000)]
    await prepareStep({ messages } as any)
    const keepRecentTurns = compactModelMessages.mock.calls[0][2].keepRecentTurns
    expect(keepRecentTurns).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Pure helper: computeKeepRecentTurns
// ---------------------------------------------------------------------------
// Turn-grouping rule (mirrored from the implementation):
//   Walk from the tail. Each turn = (a) consume trailing tool messages, then
//   (b) consume the one preceding non-system message. Stop at a system message.
//   Accumulate token estimates; stop once acc >= keepBudget. Return Math.max(turns, 1).
// ---------------------------------------------------------------------------

const msg = <R extends ModelMessage['role']>(role: R, text = 'x') =>
  ({ role, content: text }) as Extract<ModelMessage, { role: R }>

describe('computeKeepRecentTurns', () => {
  describe('grouping', () => {
    it('[system, user, assistant, tool, tool, user, assistant] with huge budget → 4 turns', () => {
      // Walk from tail (indices 0-6):
      //   i=6 assistant             → turn 1, i=5
      //   i=5 user                  → turn 2, i=4
      //   i=4 tool, i=3 tool (inner while), then i=2 assistant (non-system) → turn 3, i=1
      //   i=1 user                  → turn 4, i=0
      //   i=0 system                → break
      // Math.max(4, 1) = 4
      const messages: ModelMessage[] = [
        msg('system'),
        msg('user'),
        msg('assistant'),
        msg('tool'),
        msg('tool'),
        msg('user'),
        msg('assistant')
      ]
      expect(computeKeepRecentTurns(messages, 1e9)).toBe(4)
    })

    it('[user, assistant, tool, user, assistant] with huge budget → 4 turns', () => {
      // Walk from tail (indices 0-4):
      //   i=4 assistant             → turn 1, i=3
      //   i=3 user                  → turn 2, i=2
      //   i=2 tool (inner while), then i=1 assistant (non-system) → turn 3, i=0
      //   i=0 user                  → turn 4, i=-1
      // Math.max(4, 1) = 4
      const messages: ModelMessage[] = [msg('user'), msg('assistant'), msg('tool'), msg('user'), msg('assistant')]
      expect(computeKeepRecentTurns(messages, 1e9)).toBe(4)
    })
  })

  describe('floor / clamp', () => {
    it('system-only history → 1 (clamp floor)', () => {
      // Walk: i=0 system → break immediately, turns=0. Math.max(0,1)=1.
      const messages: ModelMessage[] = [msg('system', 'You are helpful.')]
      expect(computeKeepRecentTurns(messages, 1e9)).toBe(1)
    })

    it('empty history → 1 (clamp floor)', () => {
      // Walk: i=-1 → while exits immediately, turns=0. Math.max(0,1)=1.
      expect(computeKeepRecentTurns([], 1e9)).toBe(1)
    })
  })

  describe('budget early-exit', () => {
    it('multi-turn history with keepBudget=1 → 1 (first tail turn already meets budget)', () => {
      // The first turn from the tail accumulates at least 1 token (acc >= 1),
      // so the loop breaks after one turn. Math.max(1,1)=1.
      const messages: ModelMessage[] = [
        msg('user', 'hello'),
        msg('assistant', 'hi'),
        msg('user', 'world'),
        msg('assistant', 'ok')
      ]
      expect(computeKeepRecentTurns(messages, 1)).toBe(1)
    })
  })
})
