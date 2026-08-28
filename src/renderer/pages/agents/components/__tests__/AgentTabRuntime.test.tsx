import { cacheService } from '@data/CacheService'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  isActiveTab: true,
  useCommandHandler: vi.fn(),
  useTabSelfVisuals: vi.fn()
}))

vi.mock('@renderer/hooks/command', () => ({ useCommandHandler: runtimeMocks.useCommandHandler }))
vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => runtimeMocks.isActiveTab,
  useTabSelfVisuals: runtimeMocks.useTabSelfVisuals
}))

import { AgentTabRuntime } from '../AgentTabRuntime'

describe('AgentTabRuntime', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    runtimeMocks.isActiveTab = true
    runtimeMocks.useCommandHandler.mockReset()
    runtimeMocks.useTabSelfVisuals.mockReset()
  })

  it('syncs visuals, registers the active command, and remembers a persisted session', () => {
    const onToggleSidebar = vi.fn()

    render(
      <AgentTabRuntime
        title="Session A"
        emoji="agent-avatar"
        preserveVisuals={false}
        activeSessionId="session-a"
        activeSessionSource="query"
        onToggleSidebar={onToggleSidebar}
      />
    )

    expect(runtimeMocks.useTabSelfVisuals).toHaveBeenCalledWith({
      title: 'Session A',
      emoji: 'agent-avatar',
      appId: 'agents',
      preserveVisuals: false
    })
    expect(runtimeMocks.useCommandHandler).toHaveBeenCalledWith('app.sidebar.toggle', onToggleSidebar, {
      enabled: true
    })
    expect(cacheService.setPersist).toHaveBeenCalledWith('ui.agent.last_used_session_id', 'session-a')
  })

  it.each([
    ['background tab', false, 'query'],
    ['pending session', true, 'pending']
  ] as const)('does not remember a session for a %s', (_label, isActiveTab, activeSessionSource) => {
    runtimeMocks.isActiveTab = isActiveTab

    render(
      <AgentTabRuntime
        title="Session A"
        preserveVisuals={false}
        activeSessionId="session-a"
        activeSessionSource={activeSessionSource}
        onToggleSidebar={vi.fn()}
      />
    )

    expect(runtimeMocks.useCommandHandler).toHaveBeenCalledWith('app.sidebar.toggle', expect.any(Function), {
      enabled: isActiveTab
    })
    expect(cacheService.setPersist).not.toHaveBeenCalled()
  })
})
