const AGENT_SESSION_PREFIX = 'agent-session:'

/** Abort reason carried by the renderer's Stop action (`ai.stream.abort`). The only abort source
 *  that asks the runtime for a graceful turn interrupt instead of a session teardown. */
export const USER_STOP_ABORT_REASON = 'user-requested'

/** Check if a topicId represents an agent session (vs a normal chat). */
export function isAgentSessionTopic(topicId: string): boolean {
  return topicId.startsWith(AGENT_SESSION_PREFIX)
}

/** Extract the agent session ID from a topic ID. Throws if not an agent session topic. */
export function extractAgentSessionId(topicId: string): string {
  if (!isAgentSessionTopic(topicId)) {
    throw new Error(`Not an agent session topicId: ${topicId}`)
  }
  return topicId.slice(AGENT_SESSION_PREFIX.length)
}

/** Build the topic id for an agent session. */
export function buildAgentSessionTopicId(sessionId: string): string {
  return `${AGENT_SESSION_PREFIX}${sessionId}`
}
