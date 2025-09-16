import { describe, expect, it } from 'vitest'

import { generateGroupId, validateGroupName } from '../groupHelpers'

describe('groupHelpers', () => {
  it('generateGroupId returns unique-like strings', () => {
    const a = generateGroupId()
    const b = generateGroupId()
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(8)
    expect(a).not.toBe(b)
  })

  it('validateGroupName enforces non-empty and length', () => {
    expect(validateGroupName('')).toBe(false)
    expect(validateGroupName('   ')).toBe(false)
    expect(validateGroupName('Valid Name')).toBe(true)
    expect(validateGroupName('a'.repeat(101))).toBe(false)
  })

  it('validateGroupName rejects newlines and control chars', () => {
    expect(validateGroupName('name\nwith\nline')).toBe(false)
    // Include a control char (\u0001)
    expect(validateGroupName('name\u0001bad')).toBe(false)
  })
})
