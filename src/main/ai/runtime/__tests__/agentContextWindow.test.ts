import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'

import { resolveAgentContextWindow } from '../agentContextWindow'

const modelWith = (contextWindow: unknown) => ({ id: 'p::m', contextWindow }) as unknown as Model

describe('resolveAgentContextWindow', () => {
  it('keeps a declared positive window', () => {
    expect(resolveAgentContextWindow(modelWith(128_000))).toBe(128_000)
  })

  // A non-positive or non-finite window would make Pi compact immediately or never.
})
