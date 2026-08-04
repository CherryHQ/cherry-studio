import { describe, expect, it } from 'vitest'

import { getMessageActivityTimestamp, isTerminalMessageStatus, resolveResponseTerminalAt } from '../activityTime'

describe('activityTime', () => {
  describe('isTerminalMessageStatus', () => {
    it.each(['success', 'error', 'paused'])('treats %s as terminal', (status) => {
      expect(isTerminalMessageStatus(status)).toBe(true)
    })

    it('treats pending as non-terminal', () => {
      expect(isTerminalMessageStatus('pending')).toBe(false)
    })

    it('treats an unknown status as non-terminal', () => {
      expect(isTerminalMessageStatus('streaming')).toBe(false)
    })
  })

  describe('resolveResponseTerminalAt', () => {
    it('preserves an existing terminalAt regardless of the incoming role/status/timestamp', () => {
      expect(
        resolveResponseTerminalAt({ existingTerminalAt: 500, role: 'assistant', status: 'success', timestamp: 999 })
      ).toBe(500)
      // Even a later rewrite as a non-assistant / pending row keeps the first terminal transition.
      expect(
        resolveResponseTerminalAt({ existingTerminalAt: 500, role: 'user', status: 'pending', timestamp: 999 })
      ).toBe(500)
    })

    it('preserves an existing terminalAt of 0 (guards on != null, not truthiness)', () => {
      expect(
        resolveResponseTerminalAt({ existingTerminalAt: 0, role: 'assistant', status: 'success', timestamp: 999 })
      ).toBe(0)
    })

    it('stamps the timestamp for an assistant row reaching a terminal status', () => {
      expect(resolveResponseTerminalAt({ role: 'assistant', status: 'success', timestamp: 1000 })).toBe(1000)
      expect(resolveResponseTerminalAt({ role: 'assistant', status: 'error', timestamp: 1000 })).toBe(1000)
      expect(resolveResponseTerminalAt({ role: 'assistant', status: 'paused', timestamp: 1000 })).toBe(1000)
    })

    it('returns null for an assistant row still pending', () => {
      expect(resolveResponseTerminalAt({ role: 'assistant', status: 'pending', timestamp: 1000 })).toBeNull()
    })

    it('returns null for a non-assistant row even at a terminal status (only assistant rows get a terminalAt)', () => {
      expect(resolveResponseTerminalAt({ role: 'user', status: 'success', timestamp: 1000 })).toBeNull()
      expect(resolveResponseTerminalAt({ role: 'system', status: 'success', timestamp: 1000 })).toBeNull()
    })
  })

  describe('getMessageActivityTimestamp', () => {
    it('uses createdAt for a user row and ignores terminalAt', () => {
      expect(getMessageActivityTimestamp({ role: 'user', createdAt: 100, terminalAt: 999 })).toBe(100)
      expect(getMessageActivityTimestamp({ role: 'user', createdAt: 100 })).toBe(100)
    })

    it('uses max(createdAt, terminalAt) for an assistant row', () => {
      expect(getMessageActivityTimestamp({ role: 'assistant', createdAt: 100, terminalAt: 200 })).toBe(200)
      expect(getMessageActivityTimestamp({ role: 'assistant', createdAt: 200, terminalAt: 100 })).toBe(200)
    })

    it('falls back to createdAt for an assistant row without a terminalAt', () => {
      expect(getMessageActivityTimestamp({ role: 'assistant', createdAt: 150, terminalAt: null })).toBe(150)
      expect(getMessageActivityTimestamp({ role: 'assistant', createdAt: 150 })).toBe(150)
    })

    it('contributes nothing for structural/system rows (system, tool, root)', () => {
      expect(getMessageActivityTimestamp({ role: 'system', createdAt: 100 })).toBeNull()
      expect(getMessageActivityTimestamp({ role: 'tool', createdAt: 100, terminalAt: 200 })).toBeNull()
      expect(getMessageActivityTimestamp({ role: 'root', createdAt: 100 })).toBeNull()
    })
  })
})
