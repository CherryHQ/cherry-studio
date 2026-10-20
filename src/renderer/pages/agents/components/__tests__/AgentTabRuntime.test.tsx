import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

const runtimeMocks = vi.hoisted(() => ({ isActiveTab: true }))
vi.mock('@renderer/hooks/command', () => ({ useCommandHandler: vi.fn() }))

vi.mock('@renderer/hooks/tab', () => ({ useIsActiveTab: () => runtimeMocks.isActiveTab }))

import { AgentTabRuntime } from '../AgentTabRuntime'

describe('AgentTabRuntime', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    runtimeMocks.isActiveTab = true
  })

  it('remembers a persisted conversation for the active tab', () => {
    render(<AgentTabRuntime activeSessionId="current" activeSessionSource="query" onToggleSidebar={vi.fn()} />)
    expect(cacheService.getPersist('ui.agent.last_used_session_id')).toBe('current')
  })

  it.each([
    ['background tab', false, 'query'],
    ['pending conversation', true, 'pending']
  ] as const)('preserves the remembered conversation for a %s', (_label, isActiveTab, activeSource) => {
    cacheService.setPersist('ui.agent.last_used_session_id', 'previous')
    runtimeMocks.isActiveTab = isActiveTab
    render(<AgentTabRuntime activeSessionId="current" activeSessionSource={activeSource} onToggleSidebar={vi.fn()} />)
    expect(cacheService.getPersist('ui.agent.last_used_session_id')).toBe('previous')
  })
})
