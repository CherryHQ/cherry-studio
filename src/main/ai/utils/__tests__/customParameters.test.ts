import { describe, expect, it } from 'vitest'

import { makeAssistant } from '../../__tests__/fixtures'
import { getCustomParameters } from '../reasoning'

describe('custom request parameters', () => {
  it('preserves omission, JSON decoding, explicit undefined, duplicate precedence and reserved keys', () => {
    const assistant = makeAssistant({
      settings: {
        customParameters: [
          { name: ' ', type: 'string', value: 'ignored' },
          { name: 'duplicate', type: 'number', value: 1 },
          { name: 'duplicate', type: 'number', value: 2 },
          { name: 'json', type: 'json', value: '{"enabled":true}' },
          { name: 'invalid', type: 'json', value: 'raw text' },
          { name: 'omitted', type: 'json', value: 'undefined' },
          { name: '__proto__', type: 'string', value: 'data' },
          { name: 'preparsed', type: 'json', value: { enabled: true } }
        ]
      }
    })

    const result = getCustomParameters(assistant)

    expect(result).toEqual({
      duplicate: 2,
      json: { enabled: true },
      invalid: 'raw text',
      omitted: undefined,
      ['__proto__']: 'data',
      preparsed: { enabled: true }
    })
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })
})
