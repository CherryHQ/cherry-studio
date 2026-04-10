import { describe, expect, it } from 'vitest'

import { toOptionValue, toRealValue } from '../select'

describe('toOptionValue', () => {
  describe('primitive values', () => {
    it('should convert undefined to string "undefined"', () => {
      expect(toOptionValue(undefined)).toBe('undefined')
    })

    it('should convert null to string "null"', () => {
      expect(toOptionValue(null)).toBe('null')
    })

    it('should convert true to string "true"', () => {
      expect(toOptionValue(true)).toBe('true')
    })

    it('should convert false to string "false"', () => {
      expect(toOptionValue(false)).toBe('false')
    })
  })

  describe('string values', () => {
    it('should return string as-is', () => {
      expect(toOptionValue('hello')).toBe('hello')
    })

    it('should return empty string as-is', () => {
      expect(toOptionValue('')).toBe('')
    })

    it('should return string with special characters as-is', () => {
      expect(toOptionValue('hello-world_123')).toBe('hello-world_123')
    })

    it('should return string that looks like a boolean as-is', () => {
      expect(toOptionValue('True')).toBe('True')
      expect(toOptionValue('FALSE')).toBe('FALSE')
    })
  })

  describe('mixed type scenarios', () => {
    it('should handle union types correctly', () => {
      const values: Array<string | boolean | null | undefined> = ['test', true, false, null, undefined, '']

      expect(toOptionValue(values[0])).toBe('test')
      expect(toOptionValue(values[1])).toBe('true')
      expect(toOptionValue(values[2])).toBe('false')
      expect(toOptionValue(values[3])).toBe('null')
      expect(toOptionValue(values[4])).toBe('undefined')
      expect(toOptionValue(values[5])).toBe('')
    })
  })
})

describe('toRealValue', () => {
  describe('special string values', () => {
    it('should convert string "undefined" to undefined', () => {
      expect(toRealValue('undefined')).toBeUndefined()
    })

    it('should convert string "null" to null', () => {
      expect(toRealValue('null')).toBeNull()
    })

    it('should convert string "true" to boolean true', () => {
      expect(toRealValue('true')).toBe(true)
    })

    it('should convert string "false" to boolean false', () => {
      expect(toRealValue('false')).toBe(false)
    })
  })

  describe('regular string values', () => {
    it('should return regular string as-is', () => {
      expect(toRealValue('hello')).toBe('hello')
    })

    it('should return empty string as-is', () => {
      expect(toRealValue('')).toBe('')
    })

    it('should return string with special characters as-is', () => {
      expect(toRealValue('hello-world_123')).toBe('hello-world_123')
    })

    it('should return string that looks like special value but with different casing', () => {
      expect(toRealValue('Undefined')).toBe('Undefined')
      expect(toRealValue('NULL')).toBe('NULL')
      expect(toRealValue('True')).toBe('True')
      expect(toRealValue('False')).toBe('False')
    })
  })

  describe('edge cases', () => {
    it('should handle strings containing special values as substring', () => {
      expect(toRealValue('undefined_value')).toBe('undefined_value')
      expect(toRealValue('null_check')).toBe('null_check')
      expect(toRealValue('true_condition')).toBe('true_condition')
      expect(toRealValue('false_flag')).toBe('false_flag')
    })

    it('should handle strings with whitespace', () => {
      expect(toRealValue(' undefined')).toBe(' undefined')
      expect(toRealValue('null ')).toBe('null ')
      expect(toRealValue(' true ')).toBe(' true ')
    })
  })
})

describe('toOptionValue and toRealValue roundtrip', () => {
  it('should correctly convert and restore undefined', () => {
    const original = undefined
    const option = toOptionValue(original)
    const restored = toRealValue(option)
    expect(restored).toBeUndefined()
  })

  it('should correctly convert and restore null', () => {
    const original = null
    const option = toOptionValue(original)
    const restored = toRealValue(option)
    expect(restored).toBeNull()
  })

  it('should correctly convert and restore true', () => {
    const original = true
    const option = toOptionValue(original)
    const restored = toRealValue(option)
    expect(restored).toBe(true)
  })

  it('should correctly convert and restore false', () => {
    const original = false
    const option = toOptionValue(original)
    const restored = toRealValue(option)
    expect(restored).toBe(false)
  })

  it('should correctly convert and restore string values', () => {
    const strings = ['hello', '', 'test-123', 'some_value']
    strings.forEach((str) => {
      const option = toOptionValue(str)
      const restored = toRealValue(option)
      expect(restored).toBe(str)
    })
  })

  it('should handle array of mixed values', () => {
    const values: Array<string | boolean | null | undefined> = ['test', true, false, null, undefined]

    const options = values.map(toOptionValue)
    const restored = options.map(toRealValue)

    expect(restored[0]).toBe('test')
    expect(restored[1]).toBe(true)
    expect(restored[2]).toBe(false)
    expect(restored[3]).toBeNull()
    expect(restored[4]).toBeUndefined()
  })
})
