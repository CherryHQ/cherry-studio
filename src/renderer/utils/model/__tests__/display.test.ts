import { MODEL_PRIORITY_MODE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { getModelDisplayName } from '../display'

describe('getModelDisplayName', () => {
  it.each([
    { priorityMode: undefined, expected: 'MiniMax M2.1' },
    { priorityMode: MODEL_PRIORITY_MODE.NONE, expected: 'MiniMax M2.1' },
    { priorityMode: MODEL_PRIORITY_MODE.MINIMAX, expected: 'MiniMax M2.1 ⚡️' }
  ])('formats priority mode $priorityMode without changing the model name', ({ priorityMode, expected }) => {
    const model = { id: 'minimax::m2.1', name: 'MiniMax M2.1', priorityMode }

    expect(getModelDisplayName(model)).toBe(expected)
    expect(model.name).toBe('MiniMax M2.1')
    expect(model.id).toBe('minimax::m2.1')
  })
})
