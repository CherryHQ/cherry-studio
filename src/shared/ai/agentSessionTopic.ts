const AGENT_SESSION_PREFIX = 'agent-session:'

/** Check if a topicId represents an agent session (vs a normal chat). */
export function isAgentSessionTopic(topicId: string): boolean {
  return topicId.startsWith(AGENT_SESSION_PREFIX)
}

/** Extract the agent session ID from a topic ID. Throws if not an agent session topic. */
export function extractAgentSessionId(topicId: string): string {
  if (!isAgentSessionTopic(topicId)) {
    throw new Error(`Not an agent session topicId: ${topicId}`)
  }
  return topicId.slice(AGENT_SESSION_PREFIX.length).split('/context/', 1)[0]
}

/** Build the topic id for an agent session. */
export function buildAgentSessionTopicId(sessionId: string, contextId?: string): string {
  return contextId ? `${AGENT_SESSION_PREFIX}${sessionId}/context/${contextId}` : `${AGENT_SESSION_PREFIX}${sessionId}`
}

export function extractAgentContextId(topicId: string): string | undefined {
  return topicId.split('/context/')[1]
}
