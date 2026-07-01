import { AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY } from '@shared/ai/agentSessionSlashCommands'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAgentSessionSlashCommands } from '../useAgentSessionSlashCommands'

// The hook reads the main-owned catalog via the read-only `useSharedCacheValue` (globally mocked).
// The non-mutation guarantee of that hook is covered in data/hooks/__tests__/useCache.test.ts; here
// we cover the read + normalisation + fallback behaviour.
describe('useAgentSessionSlashCommands', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it("normalises Main's published catalog to the composer's command shape", () => {
    MockUseCacheUtils.mockSharedCacheValueReturn(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-1'), [
      { name: 'deploy', description: 'Deploy the app' }
    ] as never)

    const { result } = renderHook(() => useAgentSessionSlashCommands('session-1'))

    expect(result.current).toEqual([{ command: '/deploy', description: 'Deploy the app' }])
  })

  it('returns undefined (builtin fallback) when no catalog is cached', () => {
    const { result } = renderHook(() => useAgentSessionSlashCommands('session-2'))

    expect(result.current).toBeUndefined()
  })

  it('returns undefined when no session is selected', () => {
    const { result } = renderHook(() => useAgentSessionSlashCommands(undefined))

    expect(result.current).toBeUndefined()
  })
})
