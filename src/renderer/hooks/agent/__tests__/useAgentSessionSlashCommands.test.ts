import { mockCacheService, MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY } from '@shared/ai/agentSessionSlashCommands'

import { useAgentSessionSlashCommands } from '../useAgentSessionSlashCommands'

// The hook observes the main-owned catalog read-only via `useSharedCacheValue` (globally mocked).
// It must only ever read — never seed a default — or it would clobber Main's published catalog
// before the first sync lands; that guarantee is asserted below.
describe('useAgentSessionSlashCommands', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    MockUseCacheUtils.resetMocks()
  })

  it("normalises Main's published catalog to the composer's command shape", () => {
    MockUseCacheUtils.setSharedCacheValue(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-1'), [
      { name: 'deploy', description: 'Deploy the app' }
    ] as any)

    const { result } = renderHook(() => useAgentSessionSlashCommands('session-1'))

    expect(result.current).toEqual([{ command: '/deploy', description: 'Deploy the app' }])
  })

  it('preserves builtin ownership without promoting custom commands', () => {
    MockUseCacheUtils.setSharedCacheValue(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('ownership'), [
      { name: 'clear', description: 'SDK clear', argumentHint: '', builtin: true },
      { name: 'clear', description: 'Plugin clear', argumentHint: '', builtin: false },
      { name: 'deploy', description: 'User deploy', argumentHint: '' }
    ])

    const { result } = renderHook(() => useAgentSessionSlashCommands('ownership'))

    expect(result.current).toEqual([
      { command: '/clear', description: 'SDK clear', builtin: true },
      { command: '/clear', description: 'Plugin clear', builtin: false },
      { command: '/deploy', description: 'User deploy', builtin: undefined }
    ])
  })

  it('returns undefined (builtin fallback) when no catalog is cached', () => {
    const { result } = renderHook(() => useAgentSessionSlashCommands('session-2'))

    expect(result.current).toBeUndefined()
  })

  it('returns undefined when no session is selected', () => {
    const { result } = renderHook(() => useAgentSessionSlashCommands(undefined))

    expect(result.current).toBeUndefined()
  })

  it('never writes to the shared cache (read-only, cannot clobber the owner)', () => {
    renderHook(() => useAgentSessionSlashCommands('session-3'))

    expect(mockCacheService.setShared).not.toHaveBeenCalled()
  })
})
