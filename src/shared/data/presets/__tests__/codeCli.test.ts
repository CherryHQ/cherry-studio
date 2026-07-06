import { describe, expect, it } from 'vitest'

import { CodeCliConfigsSchema } from '../codeCli'

describe('code CLI schemas', () => {
  it('accepts sparse tool configs', () => {
    expect(CodeCliConfigsSchema.safeParse({}).success).toBe(true)
    expect(
      CodeCliConfigsSchema.safeParse({
        'claude-code': {
          providers: {
            anthropic: {
              modelId: 'anthropic::claude-sonnet-4-5'
            }
          },
          current: 'anthropic'
        }
      }).success
    ).toBe(true)
  })

  it('rejects unknown tool config keys', () => {
    expect(
      CodeCliConfigsSchema.safeParse({
        'custom-cli': {
          providers: {},
          current: null
        }
      }).success
    ).toBe(false)
  })
})
