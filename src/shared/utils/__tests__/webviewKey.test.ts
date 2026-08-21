import { describe, expect, it } from 'vitest'

import { isForwardableGuestKey, isHostOwnedGuestKey } from '../webviewKey'

const key = (over: Partial<Parameters<typeof isForwardableGuestKey>[0]>) => ({
  key: 'a',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...over
})

describe('isForwardableGuestKey', () => {
  it('keeps plain typing inside the guest frame', () => {
    // Password characters must not reach the host over IPC.
    for (const char of ['a', 'Z', '4', '@', ' ']) {
      expect(isForwardableGuestKey(key({ key: char }))).toBe(false)
    }
  })

  it('forwards every key a shipped command can bind to', () => {
    expect(isForwardableGuestKey(key({ key: 'f', ctrlKey: true }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: 'Tab', ctrlKey: true }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: '=', metaKey: true }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: 'Escape' }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: 'Enter' }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: 'F12' }))).toBe(true)
  })

  it('does not mistake letters for function keys', () => {
    expect(isForwardableGuestKey(key({ key: 'F' }))).toBe(false)
    expect(isForwardableGuestKey(key({ key: 'F13' }))).toBe(false)
  })
})

describe('isHostOwnedGuestKey', () => {
  it('claims only find, print and save, and only with a modifier', () => {
    expect(isHostOwnedGuestKey(key({ key: 'f', ctrlKey: true }))).toBe(true)
    expect(isHostOwnedGuestKey(key({ key: 'P', metaKey: true }))).toBe(true)
    expect(isHostOwnedGuestKey(key({ key: 's', ctrlKey: true }))).toBe(true)
    // A bare letter is the guest page's to handle.
    expect(isHostOwnedGuestKey(key({ key: 'f' }))).toBe(false)
    expect(isHostOwnedGuestKey(key({ key: 'a', ctrlKey: true }))).toBe(false)
  })
})
