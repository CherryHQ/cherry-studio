import { describe, expect, it } from 'vitest'

import { operationResultSchema } from '../common'

describe('operationResultSchema', () => {
  it('accepts a bare success', () => {
    expect(operationResultSchema.safeParse({ success: true }).success).toBe(true)
  })

  it('requires a message on the failure arm', () => {
    expect(operationResultSchema.safeParse({ success: false, message: 'boom' }).success).toBe(true)
    expect(operationResultSchema.safeParse({ success: false }).success).toBe(false)
  })
})
