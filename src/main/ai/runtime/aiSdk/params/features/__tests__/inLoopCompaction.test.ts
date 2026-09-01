import type { ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type * as AiCore from '@cherrystudio/ai-core'

const compactModelMessages = vi.fn()
vi.mock('@cherrystudio/ai-core', async (importOriginal) => ({
  ...(await importOriginal<typeof AiCore>()),
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
const COMPRESSION_LANGUAGE_MODEL = { id: 'compression-model' } as any
/** `scope.compressionModel` is a descriptor: the model plus ITS own window,
 *  so the summarize call is budgeted against the compressor and not the chat model. */
const COMPRESSION_MODEL = { languageModel: COMPRESSION_LANGUAGE_MODEL, contextWindow: null } as any

/** Endpoint wiring is only read to pick the per-dialect media cost table. */
const provider = (adapterFamily = 'anthropic') =>
  ({
    id: 'prov',
    defaultChatEndpoint: 'anthropic-messages',
    endpointConfigs: { 'anthropic-messages': { adapterFamily } }
  }) as any

const scope = (overrides: {
  chatId?: string
  contextOwner?: 'cherry' | 'caller'
  contextWindow?: number
  enabled?: boolean
  compressEnabled?: boolean
  compressionModel?: unknown
  adapterFamily?: string
}) =>
  ({
    request: { chatId: overrides.chatId, contextOwner: overrides.contextOwner },
    model: { id: 'prov::model', contextWindow: overrides.contextWindow },
    provider: provider(overrides.adapterFamily),
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

/** An assistant message whose tokenx estimate is ~`approxTokens`. */
const assistantMessage = (approxTokens: number): ModelMessage => ({
  role: 'assistant',
  content: 'word '.repeat(approxTokens)
})

/** A tool-result message (the trailing delta after an assistant) ~`approxTokens`. */
const toolMessage = (approxTokens: number): ModelMessage => ({
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: 'c1',
      toolName: 't',
      output: { type: 'text', value: 'word '.repeat(approxTokens) }
    }
  ]
})

/**
 * A first-turn user message: a little text plus a large inlined base64 media attachment.
 * `base64Chars` sizes the payload — scored as natural-language text it lands in the
 * millions of tokens, which is exactly the #17837 report (13 MB MP3 → 18 M base64 chars →
 * 3.7 M estimated vs the provider's real 20 k).
 */
const audioAttachmentMessage = (base64Chars: number): ModelMessage => ({
  role: 'user',
  content: [
    { type: 'text', text: 'Please transcribe this audio.' },
    { type: 'file', mediaType: 'audio/mpeg', filename: 'clip.mp3', data: 'QUJDRA'.repeat(Math.ceil(base64Chars / 6)) }
  ]
})

/** A `steps` array carrying one prior step's provider usage. */
const stepsWithUsage = (usage: Partial<{ inputTokens: number; outputTokens: number; totalTokens: number }>) =>
  [{ usage }] as any

describe('inLoopCompactionFeature', () => {
  // --- applies ---

  it('applies for a persistent chat with contextWindow > 0, compression enabled, and a model', () => {
    expect(inLoopCompactionFeature.applies?.(scope({ chatId: 'topic-1', contextWindow: CONTEXT_WINDOW }))).toBe(true)
  })

  it('does not apply when chatId is missing', () => {
    expect(inLoopCompactionFeature.applies?.(scope({ contextWindow: CONTEXT_WINDOW }))).toBe(false)
  })

  it('does not gate on contextWindow — required input guaranteed upstream, not checked here', () => {
    // The compaction layer treats contextWindow as a required precondition (the model
    // layer's contract); it neither fabricates a fallback nor excludes when absent.
    expect(inLoopCompactionFeature.applies?.(scope({ chatId: 'topic-1', contextWindow: undefined }))).toBe(true)
  })

  it('does not apply for agent-session topics', () => {
    expect(
      inLoopCompactionFeature.applies?.(scope({ chatId: 'agent-session:s1', contextWindow: CONTEXT_WINDOW }))
    ).toBe(false)
  })

  it('does not apply for temporary-chat topics', () => {
    expect(inLoopCompactionFeature.applies?.(scope({ chatId: 'temp:t1', contextWindow: CONTEXT_WINDOW }))).toBe(false)
  })

  it('does not apply for caller-owned gateway requests', () => {
    expect(
      inLoopCompactionFeature.applies?.(
        scope({ chatId: 'gateway-request-1', contextOwner: 'caller', contextWindow: CONTEXT_WINDOW })
      )
    ).toBe(false)
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

  const getPrepareStep = (customScope?: ReturnType<typeof scope>) => {
    const hooks = inLoopCompactionFeature.contributeHooks!(
      customScope ?? scope({ chatId: 'topic-1', contextWindow: CONTEXT_WINDOW })
    )
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

  // #17837: at step 0 there is no usage anchor, so the whole prompt is estimated locally.
  // Stringifying a file part fed its base64 payload to the tokenizer and scored a 13 MB MP3
  // at ~3.7 M tokens (~183x the provider's 20 k), firing compaction on a first turn that has
  // nothing to fold. Media must be priced by modality, never by payload length.
  it('does not price a base64 media attachment as text (no false first-turn compaction)', async () => {
    compactModelMessages.mockClear()
    const prepareStep = getPrepareStep()
    // ~3M base64 chars: as text that dwarfs the 80k trigger; as audio it costs the bounded
    // per-dialect fallback, so the first turn stays under budget and never folds.
    const messages = [audioAttachmentMessage(3_000_000)]
    const result = await prepareStep({ messages } as any) // step 0 → no usage anchor → full local pass
    expect(compactModelMessages).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  // The media exclusion must not blind the trigger to real text.
  it('still compacts when oversized text sits alongside a large media attachment', async () => {
    compactModelMessages.mockClear()
    const compacted = [userMessage(10)]
    compactModelMessages.mockResolvedValue(compacted)
    const prepareStep = getPrepareStep()
    const messages = [audioAttachmentMessage(3_000_000), assistantMessage(5), userMessage(90_000)]
    const result = await prepareStep({ messages } as any)
    expect(compactModelMessages).toHaveBeenCalledOnce()
    expect(result).toEqual({ messages: compacted })
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
    // The summarize call is itself window-bound, so it carries its own budgets:
    // output sized from the window, input capped so the request can't overflow it.
    expect(compactModelMessages).toHaveBeenCalledWith(messages, COMPRESSION_LANGUAGE_MODEL, {
      keepRecentTurns: expect.any(Number),
      maxOutputTokens: expect.any(Number),
      maxInputTokens: expect.any(Number)
    })
    const { maxOutputTokens, maxInputTokens } = compactModelMessages.mock.calls[0][2]
    expect(maxOutputTokens + maxInputTokens).toBeLessThan(100_000) // fits the window
    expect(result).toEqual({ messages: compacted })
  })

  // The summarize call goes to the COMPRESSOR, so its budget must come from the
  // compressor's window. Sizing it by the chat model's window overflows an
  // explicitly-picked small compressor (8k compressor on a 128k chat).
  it('budgets the summarize call by the compressor window, not the chat window', async () => {
    compactModelMessages.mockClear()
    compactModelMessages.mockResolvedValue([userMessage(10)])
    const prepareStep = getPrepareStep(
      scope({
        chatId: 'topic-1',
        contextWindow: CONTEXT_WINDOW, // 100k chat model
        compressionModel: { languageModel: COMPRESSION_LANGUAGE_MODEL, contextWindow: 8_000 }
      })
    )
    await prepareStep({ messages: [userMessage(90_000)] } as any)
    const { maxOutputTokens, maxInputTokens } = compactModelMessages.mock.calls[0][2]
    expect(maxOutputTokens + maxInputTokens).toBeLessThan(8_000)
  })

  // `compactModelMessages` propagates provider errors. Letting one escape
  // `prepareStep` kills the whole chat turn — a misconfigured or rate-limited
  // compressor would take the conversation down with it.
  it('survives a failing compressor instead of failing the turn', async () => {
    compactModelMessages.mockClear()
    compactModelMessages.mockRejectedValue(Object.assign(new Error('401 invalid api key'), { name: 'APICallError' }))
    const prepareStep = getPrepareStep()
    const messages = [userMessage(90_000)]
    await expect(prepareStep({ messages } as any)).resolves.toBeUndefined()
    expect(compactModelMessages).toHaveBeenCalledOnce()
  })

  it('disables compaction for the rest of the request after a failure (no retry storm)', async () => {
    compactModelMessages.mockClear()
    compactModelMessages.mockRejectedValue(new Error('429 rate limited'))
    const prepareStep = getPrepareStep()
    await prepareStep({ messages: [userMessage(90_000)] } as any)
    await prepareStep({ messages: [userMessage(95_000)] } as any)
    expect(compactModelMessages).toHaveBeenCalledOnce()
  })

  // Compaction is a full summarize round-trip mid tool-loop — seconds of
  // apparent silence. It reports through the sink so the UI can say so, and
  // MUST settle on every exit or the spinner outlives the work.
  describe('compaction progress events', () => {
    const withSink = () => {
      const events: Array<{ id: string; status: string; phase: string }> = []
      const s = scope({ chatId: 'topic-1', contextWindow: CONTEXT_WINDOW })
      ;(s as { compactionSink?: unknown }).compactionSink = (id: string, d: { status: string; phase: string }) =>
        events.push({ id, ...d })
      return { events, prepareStep: getPrepareStep(s) }
    }

    it('brackets a successful fold with compacting → done', async () => {
      compactModelMessages.mockClear()
      compactModelMessages.mockResolvedValue([userMessage(10)])
      const { events, prepareStep } = withSink()
      await prepareStep({ messages: [userMessage(90_000)] } as any)
      expect(events.map((e) => e.status)).toEqual(['compacting', 'done'])
      expect(events.every((e) => e.phase === 'in-loop')).toBe(true)
    })

    it('settles even when the compressor fails (no stuck spinner, no false marker)', async () => {
      compactModelMessages.mockClear()
      compactModelMessages.mockRejectedValue(new Error('429 rate limited'))
      const { events, prepareStep } = withSink()
      await prepareStep({ messages: [userMessage(90_000)] } as any)
      // Nothing was folded, so the spinner clears as `skipped` rather than claiming a compaction.
      expect(events.map((e) => e.status)).toEqual(['compacting', 'skipped'])
    })

    // #17837's second half: the `done` anchor was emitted BEFORE the `compacted === candidate`
    // check, so a fold that replaced nothing still surfaced as a completed compaction —
    // preTokens === postTokens, foldedCount 0, yet the UI said "context compacted".
    it('reports a no-op fold as skipped, with no before/after metrics', async () => {
      compactModelMessages.mockClear()
      const { events, prepareStep } = withSink()
      const messages = [userMessage(90_000)]
      // No-op contract: compactModelMessages returns the input reference unchanged.
      compactModelMessages.mockResolvedValue(messages)
      const result = await prepareStep({ messages } as any)
      expect(result).toBeUndefined()
      expect(events.map((e) => e.status)).toEqual(['compacting', 'skipped'])
      const settled = events.at(-1)!
      expect(settled).not.toHaveProperty('preTokens')
      expect(settled).not.toHaveProperty('postTokens')
      expect(settled).not.toHaveProperty('foldedCount')
    })

    it('still reports a real fold as done, with its metrics', async () => {
      compactModelMessages.mockClear()
      compactModelMessages.mockResolvedValue([userMessage(10)])
      const { events, prepareStep } = withSink()
      await prepareStep({ messages: [userMessage(90_000)] } as any)
      const settled = events.at(-1) as unknown as Record<string, unknown>
      expect(settled.status).toBe('done')
      expect(settled.preTokens).toBeGreaterThan(settled.postTokens as number)
      expect(settled.foldedCount).toBe(0) // 1 message → 1 message, but the CONTENT was replaced
    })

    // A tool-heavy turn folds repeatedly; a shared id made every later fold
    // overwrite the previous one's anchor, so the timeline showed one marker
    // reflecting only the last fold.
    it('gives each fold its own anchor id, shared by that fold two events', async () => {
      compactModelMessages.mockClear()
      const { events, prepareStep } = withSink()
      compactModelMessages.mockResolvedValue([userMessage(10)])
      const first = [userMessage(90_000)]
      await prepareStep({ messages: first } as any)
      // The fold cache consumes `first`, so the next step must bring a large
      // INCREMENT for the candidate to cross the trigger again.
      compactModelMessages.mockResolvedValue([userMessage(20)])
      await prepareStep({ messages: [...first, userMessage(90_000)] } as any)

      expect(events).toHaveLength(4)
      const [a1, a2, b1, b2] = events
      expect(a1.id).toBe(a2.id) // one fold → one anchor that changes state
      expect(b1.id).toBe(b2.id)
      expect(a1.id).not.toBe(b1.id) // separate folds → separate anchors
    })

    it('emits nothing when the prompt is under the trigger', async () => {
      compactModelMessages.mockClear()
      const { events, prepareStep } = withSink()
      await prepareStep({ messages: [userMessage(100)] } as any)
      expect(events).toEqual([])
    })
  })

  it('still propagates a user abort — that IS the turn ending', async () => {
    compactModelMessages.mockClear()
    compactModelMessages.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const prepareStep = getPrepareStep()
    await expect(prepareStep({ messages: [userMessage(90_000)] } as any)).rejects.toThrow('aborted')
  })

  it('returns no override when compactModelMessages returns the same reference (no-op)', async () => {
    compactModelMessages.mockClear()
    const prepareStep = getPrepareStep()
    const messages = [userMessage(90_000)]
    // compactModelMessages returns the input reference unchanged on a no-op.
    compactModelMessages.mockResolvedValue(messages)
    const result = await prepareStep({ messages } as any)
    expect(compactModelMessages).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })

  it('memoizes the fold: a later over-budget step folds only the increment, never the consumed originals', async () => {
    compactModelMessages.mockClear()
    const prepareStep = getPrepareStep()

    // Step 1: over budget → full fold.
    const original = [userMessage(90_000)]
    const firstFold = [userMessage(10)] // tiny summary view
    compactModelMessages.mockResolvedValueOnce(firstFold)
    await prepareStep({ messages: original } as any)

    // Step 2: loop re-appends history + a huge new tool result → over budget again.
    const grown = [...original, assistantMessage(5), toolMessage(85_000)]
    const secondFold = [userMessage(12)]
    compactModelMessages.mockResolvedValueOnce(secondFold)
    const result = await prepareStep({ messages: grown } as any)

    // The second summarizer input is [foldedPrefix, ...NEW messages] — the
    // 90k original is represented by its 10-token fold, not re-summarized
    // (finding #4: summarizer input grew 44k→66k per step without this).
    expect(compactModelMessages).toHaveBeenCalledTimes(2)
    const secondInput = compactModelMessages.mock.calls[1][0] as ModelMessage[]
    expect(secondInput[0]).toBe(firstFold[0])
    expect(secondInput).not.toContain(original[0])
    expect(secondInput).toHaveLength(1 + 2) // folded prefix + the 2 new messages
    expect(result).toEqual({ messages: secondFold })
  })

  it('serves a still-fitting folded view with zero LLM calls', async () => {
    compactModelMessages.mockClear()
    const prepareStep = getPrepareStep()

    const original = [userMessage(90_000)]
    const fold = [userMessage(10)]
    compactModelMessages.mockResolvedValueOnce(fold)
    await prepareStep({ messages: original } as any)

    // Next step adds only a small delta: folded view is far under trigger.
    const grown = [...original, assistantMessage(5), toolMessage(5)]
    const result = await prepareStep({ messages: grown } as any)

    expect(compactModelMessages).toHaveBeenCalledTimes(1) // no second summarize
    expect(result).toEqual({ messages: [...fold, ...grown.slice(1)] })
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

  // --- usage-first trigger (real last-step usage anchor, tokenx fallback) ---

  it('triggers on the real last-step usage anchor even when the message text is tiny', async () => {
    compactModelMessages.mockClear()
    const compacted = [userMessage(10)]
    compactModelMessages.mockResolvedValue(compacted)
    const prepareStep = getPrepareStep()
    // tokenx of these messages is ~300 (well under the 80k trigger), but the provider
    // reported an ~85k-token last step → the anchor crosses the trigger.
    const messages = [userMessage(100), assistantMessage(100), toolMessage(100)]
    const steps = stepsWithUsage({ inputTokens: 84_900, outputTokens: 100, totalTokens: 85_000 })
    const result = await prepareStep({ messages, steps } as any)
    expect(compactModelMessages).toHaveBeenCalledOnce()
    expect(result).toEqual({ messages: compacted })
  })

  it('adds the trailing-tool delta on top of the anchor (anchor alone is under budget)', async () => {
    compactModelMessages.mockClear()
    const compacted = [userMessage(10)]
    compactModelMessages.mockResolvedValue(compacted)
    const prepareStep = getPrepareStep()
    // anchor 70k < 80k trigger; the ~15k-token tool result appended after the last
    // assistant tips the estimate over → triggers.
    const messages = [userMessage(100), assistantMessage(100), toolMessage(15_000)]
    const steps = stepsWithUsage({ inputTokens: 69_900, outputTokens: 100, totalTokens: 70_000 })
    const result = await prepareStep({ messages, steps } as any)
    expect(compactModelMessages).toHaveBeenCalledOnce()
    expect(result).toEqual({ messages: compacted })
  })

  it('falls back to tokenx when last-step usage is not trustworthy (no inputTokens)', async () => {
    compactModelMessages.mockClear()
    const prepareStep = getPrepareStep()
    // totalTokens claims 90k but inputTokens is missing (output-only) → distrust the
    // anchor → tokenx of the tiny prompt (~300) stays under the trigger → no compaction.
    const messages = [userMessage(100), assistantMessage(100), toolMessage(100)]
    const steps = stepsWithUsage({ outputTokens: 90_000, totalTokens: 90_000 })
    const result = await prepareStep({ messages, steps } as any)
    expect(result).toBeUndefined()
    expect(compactModelMessages).not.toHaveBeenCalled()
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
      expect(computeKeepRecentTurns(messages, 1e9, 'anthropic')).toBe(4)
    })

    it('[user, assistant, tool, user, assistant] with huge budget → 4 turns', () => {
      // Walk from tail (indices 0-4):
      //   i=4 assistant             → turn 1, i=3
      //   i=3 user                  → turn 2, i=2
      //   i=2 tool (inner while), then i=1 assistant (non-system) → turn 3, i=0
      //   i=0 user                  → turn 4, i=-1
      // Math.max(4, 1) = 4
      const messages: ModelMessage[] = [msg('user'), msg('assistant'), msg('tool'), msg('user'), msg('assistant')]
      expect(computeKeepRecentTurns(messages, 1e9, 'anthropic')).toBe(4)
    })
  })

  describe('floor / clamp', () => {
    it('system-only history → 1 (clamp floor)', () => {
      // Walk: i=0 system → break immediately, turns=0. Math.max(0,1)=1.
      const messages: ModelMessage[] = [msg('system', 'You are helpful.')]
      expect(computeKeepRecentTurns(messages, 1e9, 'anthropic')).toBe(1)
    })

    it('empty history → 1 (clamp floor)', () => {
      // Walk: i=-1 → while exits immediately, turns=0. Math.max(0,1)=1.
      expect(computeKeepRecentTurns([], 1e9, 'anthropic')).toBe(1)
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
      expect(computeKeepRecentTurns(messages, 1, 'anthropic')).toBe(1)
    })
  })
})
