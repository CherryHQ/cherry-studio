import { describe, expect, it, vi } from 'vitest'

// Evaluating large module graphs (icon barrels, chat chain) under full-suite
// concurrency can blow past the global testTimeout — pin a generous bound.
const PROBE_TIMEOUT = 45_000

const messageContentEvaluated = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => {
  messageContentEvaluated()
  return { default: () => null }
})

/**
 * Lazy-boundary probe (S6b): the heavy message-content chain must stay behind
 * the ActionResultContent lazy boundary — statically importing it from the
 * action components would drag it back into the window's first paint. The
 * request/preload timing itself is covered by the component tests
 * (ActionGeneral.test / ActionTranslate.test "preloads the result-content
 * chunk on mount" cases).
 */
describe('action window lazy boundary', () => {
  it(
    'importing the action components does not evaluate MessageContent',
    async () => {
      await import('../ActionGeneral')
      await import('../ActionTranslate')
      expect(messageContentEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'positive control: ActionResultContent pulls MessageContent in',
    async () => {
      await import('../ActionResultContent')
      expect(messageContentEvaluated).toHaveBeenCalledTimes(1)
    },
    PROBE_TIMEOUT
  )
})
