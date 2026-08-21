import { describe, expect, it } from 'vitest'

import { isForwardableGuestKey, isHostOwnedGuestKey } from '../webviewKey'

const key = (over: Partial<Parameters<typeof isForwardableGuestKey>[0]>) => ({
  key: 'a',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over
})

describe('isForwardableGuestKey', () => {
  it('keeps plain typing inside the guest frame', () => {
    // Password characters must not reach the host over IPC.
    for (const char of ['a', 'Z', '4', '@', ' ']) {
      expect(isForwardableGuestKey(key({ key: char }))).toBe(false)
    }
  })

  it('forwards anything a user could bind a command to', () => {
    expect(isForwardableGuestKey(key({ key: 'f', ctrlKey: true }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: 'Tab', ctrlKey: true }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: '=', metaKey: true }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: 'Escape' }))).toBe(true)
    // The whole function-key range is bindable bare, not just F1-F12.
    expect(isForwardableGuestKey(key({ key: 'F12' }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: 'F13' }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: 'F24' }))).toBe(true)
  })

  it('forwards the find overlay’s Enter navigation', () => {
    expect(isForwardableGuestKey(key({ key: 'Enter' }))).toBe(true)
    expect(isForwardableGuestKey(key({ key: 'Enter', shiftKey: true }))).toBe(true)
  })

  it('leaves bare keys that cannot carry a binding with the guest', () => {
    // Tab alone moves focus inside the page; only Ctrl+Tab is bindable.
    expect(isForwardableGuestKey(key({ key: 'Tab' }))).toBe(false)
    expect(isForwardableGuestKey(key({ key: 'F' }))).toBe(false)
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
