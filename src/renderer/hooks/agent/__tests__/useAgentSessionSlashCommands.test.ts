import { AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY } from '@shared/ai/agentSessionSlashCommands'
import { mockCacheService, MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAgentSessionSlashCommands } from '../useAgentSessionSlashCommands'

describe('useAgentSessionSlashCommands', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
  })

  it('reads a catalog Main published before mount without writing a default back (no clobber)', () => {
    const key = AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-1')
    // Main published the catalog into the shared cache before this window mounts the hook.
    MockCacheUtils.setInitialState({ shared: [[key, [{ name: 'deploy', description: 'Deploy the app' }]]] })

    const { result } = renderHook(() => useAgentSessionSlashCommands('session-1'))

    expect(result.current).toEqual([{ command: '/deploy', description: 'Deploy the app' }])
    // The crux of the regression: mounting must NOT seed the schema default back into the shared
    // cache, which would broadcast `null` to Main and clobber the already-published catalog.
    expect(mockCacheService.setShared).not.toHaveBeenCalled()
  })

  it('returns undefined (builtin fallback) when no catalog is cached, still without writing', () => {
    const { result } = renderHook(() => useAgentSessionSlashCommands('session-2'))

    expect(result.current).toBeUndefined()
    expect(mockCacheService.setShared).not.toHaveBeenCalled()
  })

  it('returns undefined when no session is selected', () => {
    const { result } = renderHook(() => useAgentSessionSlashCommands(undefined))

    expect(result.current).toBeUndefined()
    expect(mockCacheService.setShared).not.toHaveBeenCalled()
  })
})
