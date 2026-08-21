import { describe, expect, it, vi } from 'vitest'

// Evaluating large module graphs (icon barrels, chat chain) under full-suite
// concurrency can blow past the global testTimeout — pin a generous bound.
const PROBE_TIMEOUT = 45_000

const quickMessagesEvaluated = vi.hoisted(() => vi.fn())

vi.mock('../panel/QuickMessages', () => {
  quickMessagesEvaluated()
  return { default: () => null }
})

/**
 * Lazy-boundary probe (S6b): the quick assistant opens as a bar and must not
 * statically evaluate the panel, which carries the whole message rendering chain.
 */
describe('QuickAssistantView lazy boundaries', () => {
  it(
    'importing QuickAssistantView does not evaluate the message panel',
    async () => {
      await import('../QuickAssistantView')
      expect(quickMessagesEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'positive control: the panel module loads on demand',
    async () => {
      await import('../panel/QuickMessages')
      expect(quickMessagesEvaluated).toHaveBeenCalledTimes(1)
    },
    PROBE_TIMEOUT
  )
})
