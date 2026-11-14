import { describe, expect, it } from 'vitest'

import { CreateModelSchema, UpdateModelSchema } from '../models'

describe('user-writable reasoning defaults', () => {
  it.each(['high', null])('accepts a default or clear (%s)', (defaultEffort) => {
    expect(
      CreateModelSchema.parse({ providerId: 'google', modelId: 'gemini-4-carbon', reasoning: { defaultEffort } })
        .reasoning
    ).toEqual({ defaultEffort })
    expect(UpdateModelSchema.parse({ reasoning: { defaultEffort } }).reasoning).toEqual({ defaultEffort })
  })
  it.each(['controls', 'selectableEfforts', 'thinkingTokenLimits', 'unknown'])(
    'rejects catalog or unknown key %s',
    (key) => {
      expect(
        CreateModelSchema.safeParse({ providerId: 'google', modelId: 'gemini-4-carbon', reasoning: { [key]: [] } })
          .success
      ).toBe(false)
      expect(UpdateModelSchema.safeParse({ reasoning: { [key]: [] } }).success).toBe(false)
    }
  )
})
