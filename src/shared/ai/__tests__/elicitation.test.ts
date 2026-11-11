import { describe, expect, it } from 'vitest'

import { ElicitationFormSchema, elicitationContent, elicitationValidator } from '../elicitation'

const form = ElicitationFormSchema.parse({
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 8, pattern: '^[a-z]+$' },
    count: { type: 'integer', minimum: 0, maximum: 5 },
    enabled: { type: 'boolean', default: false },
    tags: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        anyOf: [
          { const: 'a', title: 'A' },
          { const: 'b', title: 'B' }
        ]
      }
    }
  },
  required: ['name', 'count', 'enabled', 'tags']
})
const valid = { name: 'hello', count: 0, enabled: false, tags: ['a'] }

describe('ACP elicitation values', () => {
  it('preserves typed false, zero and native enum IDs instead of display labels', () => {
    const content = elicitationContent(form, { 2: ['false'], 3: ['a'] }, { 0: 'hello', 1: '0' })
    expect(content).toEqual(valid)
    expect(elicitationValidator(form).safeParse(content).success).toBe(true)
  })

  it.each([
    { ...valid, name: 'x' },
    { ...valid, name: 'HELLO' },
    { ...valid, name: 'toolongname' },
    { ...valid, count: 1.5 },
    { ...valid, count: 6 },
    { ...valid, count: -1 },
    { ...valid, enabled: 'false' },
    { ...valid, tags: [] },
    { ...valid, tags: ['unknown'] },
    { ...valid, enabled: undefined }
  ])('rejects out-of-contract submitted content: %j', (value) => {
    expect(elicitationValidator(form).safeParse(value).success).toBe(false)
  })

  it('rejects nested unsupported forms and validates string formats', () => {
    expect(ElicitationFormSchema.safeParse({ properties: { nested: { type: 'object' } } }).success).toBe(false)
    expect(ElicitationFormSchema.safeParse({ properties: {}, required: ['missing'] }).success).toBe(false)
    const validator = elicitationValidator(
      ElicitationFormSchema.parse({ properties: { email: { type: 'string', format: 'email' } } })
    )
    expect(validator.safeParse({ email: 'not an email' }).success).toBe(false)
    expect(validator.safeParse({ email: 'user@example.com' }).success).toBe(true)
  })
})
