import { AgentType, ApiModelsFilter } from '@renderer/types'

const SESSION_TOPIC_PREFIX = 'agent-session:'

export const buildAgentSessionTopicId = (sessionId: string): string => {
  return `${SESSION_TOPIC_PREFIX}${sessionId}`
}

export const isAgentSessionTopicId = (topicId: string): boolean => {
  return topicId.startsWith(SESSION_TOPIC_PREFIX)
}

export const extractAgentSessionIdFromTopicId = (topicId: string): string => {
  return topicId.replace(SESSION_TOPIC_PREFIX, '')
}

export const getModelFilterByAgentType = (type: AgentType): ApiModelsFilter => {
  switch (type) {
    case 'claude-code':
      return {
        supportAnthropic: true
      }
    default:
      return {}
  }
}
