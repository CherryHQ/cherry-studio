import { Topic } from '@renderer/types'

import { getDefaultTopic as getDefaultTopicFromAssistant } from './AssistantService'

/**
 * 获取默认话题（用默认助手）
 * @returns 默认话题对象
 */
export function getDefaultTopic(): Topic {
  return getDefaultTopicFromAssistant('default')
}
