import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

const tabMocks = vi.hoisted(() => ({ isActiveTab: true }))

vi.mock('@renderer/hooks/tab', () => ({ useIsActiveTab: () => tabMocks.isActiveTab }))

import { HomeTabRuntime } from '../HomeTabRuntime'

describe('HomeTabRuntime', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    tabMocks.isActiveTab = true
  })

  it('remembers a persisted conversation for the active tab', () => {
    render(<HomeTabRuntime activeTopicId="current" activeTopicSource="query" />)
    expect(cacheService.getPersist('ui.chat.last_used_topic_id')).toBe('current')
  })

  it.each([
    ['background tab', false, 'query'],
    ['pending conversation', true, 'pending']
  ] as const)('preserves the remembered conversation for a %s', (_label, isActiveTab, activeSource) => {
    cacheService.setPersist('ui.chat.last_used_topic_id', 'previous')
    tabMocks.isActiveTab = isActiveTab
    render(<HomeTabRuntime activeTopicId="current" activeTopicSource={activeSource} />)
    expect(cacheService.getPersist('ui.chat.last_used_topic_id')).toBe('previous')
  })
})
