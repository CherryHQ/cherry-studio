import type { PermissionMode, Query } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import { registerActiveQuery, setActiveSessionPermissionMode, unregisterActiveQuery } from '../active-queries'

const makeFakeQuery = (): Pick<Query, 'setPermissionMode'> & { setPermissionMode: ReturnType<typeof vi.fn> } => ({
  setPermissionMode: vi.fn().mockResolvedValue(undefined)
})

describe('setActiveSessionPermissionMode', () => {
  it('returns false when no query is registered for the session id', async () => {
    const result = await setActiveSessionPermissionMode('non-existent-session', 'bypassPermissions')
    expect(result).toBe(false)
  })

  it('forwards mode to the registered query and returns true', async () => {
    const sessionId = 'session-active'
    const fakeQuery = makeFakeQuery()
    registerActiveQuery(sessionId, fakeQuery as unknown as Query)

    try {
      const mode: PermissionMode = 'bypassPermissions'
      const result = await setActiveSessionPermissionMode(sessionId, mode)
      expect(result).toBe(true)
      expect(fakeQuery.setPermissionMode).toHaveBeenCalledExactlyOnceWith(mode)
    } finally {
      unregisterActiveQuery(sessionId)
    }
  })
})
