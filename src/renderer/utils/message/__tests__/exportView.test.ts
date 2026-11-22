import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { createPartsByMessageId } from '../exportView'

describe('createPartsByMessageId', () => {
  it('retains messages named __proto__ as own entries without changing the dictionary prototype', () => {
    const messages: CherryUIMessage[] = [
      { id: '__proto__', role: 'assistant', parts: [{ type: 'text', text: 'Export this message' }] }
    ]

    const partsByMessageId = createPartsByMessageId(messages)

    expect(Object.hasOwn(partsByMessageId, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(partsByMessageId)).toBe(Object.prototype)
    expect(partsByMessageId.__proto__).toEqual([{ type: 'text', text: 'Export this message' }])
  })
})
