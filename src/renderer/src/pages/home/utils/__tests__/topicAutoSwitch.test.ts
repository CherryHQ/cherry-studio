import { describe, expect, it } from 'vitest'

import { shouldForceTopicTabOnAssistantSwitch, shouldPreferTopicTab } from '../topicAutoSwitch'

describe('topicAutoSwitch', () => {
  it('shouldPreferTopicTab: 非左侧话题布局不触发', () => {
    expect(
      shouldPreferTopicTab({
        topicPosition: 'right',
        isChatRoute: true,
        clickAssistantToShowTopic: true,
        preferTopicTabFromNavState: false,
        hasTopicIdParam: false,
        hasPersistedTopicId: false
      })
    ).toBe(false)
  })

  it('shouldPreferTopicTab: 非聊天路由不触发', () => {
    expect(
      shouldPreferTopicTab({
        topicPosition: 'left',
        isChatRoute: false,
        clickAssistantToShowTopic: true,
        preferTopicTabFromNavState: false,
        hasTopicIdParam: false,
        hasPersistedTopicId: false
      })
    ).toBe(false)
  })

  it('shouldPreferTopicTab: 开关开启时触发', () => {
    expect(
      shouldPreferTopicTab({
        topicPosition: 'left',
        isChatRoute: true,
        clickAssistantToShowTopic: true,
        preferTopicTabFromNavState: false,
        hasTopicIdParam: false,
        hasPersistedTopicId: false
      })
    ).toBe(true)
  })

  it('shouldPreferTopicTab: 路由 state/参数/持久化 topicId 任一存在时触发', () => {
    expect(
      shouldPreferTopicTab({
        topicPosition: 'left',
        isChatRoute: true,
        clickAssistantToShowTopic: false,
        preferTopicTabFromNavState: true,
        hasTopicIdParam: false,
        hasPersistedTopicId: false
      })
    ).toBe(true)

    expect(
      shouldPreferTopicTab({
        topicPosition: 'left',
        isChatRoute: true,
        clickAssistantToShowTopic: false,
        preferTopicTabFromNavState: false,
        hasTopicIdParam: true,
        hasPersistedTopicId: false
      })
    ).toBe(true)

    expect(
      shouldPreferTopicTab({
        topicPosition: 'left',
        isChatRoute: true,
        clickAssistantToShowTopic: false,
        preferTopicTabFromNavState: false,
        hasTopicIdParam: false,
        hasPersistedTopicId: true
      })
    ).toBe(true)
  })

  it('shouldForceTopicTabOnAssistantSwitch: 仅在左侧布局且开关开启时触发', () => {
    expect(shouldForceTopicTabOnAssistantSwitch({ topicPosition: 'left', clickAssistantToShowTopic: true })).toBe(true)
    expect(shouldForceTopicTabOnAssistantSwitch({ topicPosition: 'left', clickAssistantToShowTopic: false })).toBe(
      false
    )
    expect(shouldForceTopicTabOnAssistantSwitch({ topicPosition: 'right', clickAssistantToShowTopic: true })).toBe(
      false
    )
  })
})
