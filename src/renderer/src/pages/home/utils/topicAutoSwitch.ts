/**
 * 左侧“助手/话题”双页签下的自动切换策略。
 *
 * 背景：
 * - “自动切换到话题”（clickAssistantToShowTopic）开启时，用户期望在选择助手后自动看到话题列表；
 * - 某些场景（例如：进入聊天路由但没有带 state、或恢复标签页）需要通过 initialTab 做默认选中；
 * - 但最终兜底仍应由“切换助手时强制切换到话题页签”保障。
 */

export function shouldPreferTopicTab(params: {
  topicPosition: 'left' | 'right'
  isChatRoute: boolean
  clickAssistantToShowTopic: boolean
  preferTopicTabFromNavState: boolean
  hasTopicIdParam: boolean
  hasPersistedTopicId: boolean
}): boolean {
  const {
    topicPosition,
    isChatRoute,
    clickAssistantToShowTopic,
    preferTopicTabFromNavState,
    hasTopicIdParam,
    hasPersistedTopicId
  } = params

  if (topicPosition !== 'left') return false
  if (!isChatRoute) return false

  return clickAssistantToShowTopic || preferTopicTabFromNavState || hasTopicIdParam || hasPersistedTopicId
}

export function shouldForceTopicTabOnAssistantSwitch(params: {
  topicPosition: 'left' | 'right'
  clickAssistantToShowTopic: boolean
}): boolean {
  return params.clickAssistantToShowTopic && params.topicPosition === 'left'
}
