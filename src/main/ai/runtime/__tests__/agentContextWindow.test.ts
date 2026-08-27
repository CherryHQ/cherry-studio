import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { DEFAULT_AGENT_CONTEXT_WINDOW, resolveAgentContextWindow } from '../agentContextWindow'

const modelWith = (contextWindow: unknown) => ({ id: 'p::m', contextWindow }) as unknown as Model

describe('resolveAgentContextWindow', () => {
  it('keeps a declared positive window', () => {
    expect(resolveAgentContextWindow(modelWith(128_000))).toBe(128_000)
  })

  // A non-positive or non-finite window would make pi/dsh compact immediately or never.
  it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '200000'])(
    'falls back to the default for %p',
    (contextWindow) => {
      expect(resolveAgentContextWindow(modelWith(contextWindow))).toBe(DEFAULT_AGENT_CONTEXT_WINDOW)
    }
  )
})
