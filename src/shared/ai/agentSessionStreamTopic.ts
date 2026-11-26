export const AGENT_SESSION_STREAM_TOPIC_CACHE_KEY = (sessionId: string) =>
  `agent.session.stream_topic.${sessionId}` as const
