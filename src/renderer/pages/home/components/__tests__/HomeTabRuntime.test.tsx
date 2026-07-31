import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

const tabMocks = vi.hoisted(() => ({
  isActiveTab: true,
  useTabSelfVisuals: vi.fn()
}))

vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => tabMocks.isActiveTab,
  useTabSelfVisuals: tabMocks.useTabSelfVisuals
}))

import { HomeTabRuntime } from '../HomeTabRuntime'

describe('HomeTabRuntime', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    tabMocks.isActiveTab = true
    tabMocks.useTabSelfVisuals.mockReset()
  })

  it('syncs visuals and remembers a persisted topic for the active tab', () => {
    render(
      <HomeTabRuntime
        title="Topic A"
        emoji="🍒"
        preserveVisuals={false}
        activeTopicId="topic-a"
        activeTopicSource="query"
      />
    )

    expect(tabMocks.useTabSelfVisuals).toHaveBeenCalledWith({
      title: 'Topic A',
      emoji: '🍒',
      appId: 'assistants',
      preserveVisuals: false
    })
    expect(cacheService.setPersist).toHaveBeenCalledWith('ui.chat.last_used_topic_id', 'topic-a')
  })

  it.each([
    ['background tab', false, 'query'],
    ['pending topic', true, 'pending']
  ] as const)('does not remember a topic for a %s', (_label, isActiveTab, activeTopicSource) => {
    tabMocks.isActiveTab = isActiveTab

    render(
      <HomeTabRuntime
        title="Topic A"
        preserveVisuals={false}
        activeTopicId="topic-a"
        activeTopicSource={activeTopicSource}
      />
    )

    expect(cacheService.setPersist).not.toHaveBeenCalled()
  })
})
