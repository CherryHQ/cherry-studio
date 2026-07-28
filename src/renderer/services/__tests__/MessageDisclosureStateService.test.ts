import { describe, expect, it } from 'vitest'

import { MESSAGE_DISCLOSURE_STATE_MAX_ENTRIES, MessageDisclosureStateService } from '../MessageDisclosureStateService'

describe('MessageDisclosureStateService', () => {
  it('enforces the production hard limit', () => {
    const service = new MessageDisclosureStateService()

    for (let index = 0; index <= MESSAGE_DISCLOSURE_STATE_MAX_ENTRIES; index += 1) {
      service.set(`message-${index}`, 'disclosure', true)
    }

    expect(service.get('message-0', 'disclosure')).toBeUndefined()
    expect(service.get(`message-${MESSAGE_DISCLOSURE_STATE_MAX_ENTRIES}`, 'disclosure')).toBe(true)
  })

  it('refreshes recency when reading a disclosure', () => {
    const service = new MessageDisclosureStateService(2)

    service.set('message-1', 'first', true)
    service.set('message-1', 'second', false)
    expect(service.get('message-1', 'first')).toBe(true)

    service.set('message-2', 'third', true)

    expect(service.get('message-1', 'first')).toBe(true)
    expect(service.get('message-1', 'second')).toBeUndefined()
    expect(service.get('message-2', 'third')).toBe(true)
  })

  it('invalidates every disclosure owned by deleted messages', () => {
    const service = new MessageDisclosureStateService(4)

    service.set('message-1', 'first', true)
    service.set('message-1', 'second', false)
    service.set('message-2', 'first', true)

    service.invalidateMessages(['message-1'])

    expect(service.get('message-1', 'first')).toBeUndefined()
    expect(service.get('message-1', 'second')).toBeUndefined()
    expect(service.get('message-2', 'first')).toBe(true)
  })
})
