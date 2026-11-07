/**
 * Whether the user explicitly stopped this session. The plan-execution handoff arms in one window
 * and Stop can land in another, so the invalidation rides shared cache instead of the stopping
 * window's state: every window that had the handoff armed sees the stop and drops it.
 *
 * Main also stops the turn itself when the handoff starts, which aborts the shared stream; that
 * teardown is not a user stop and must not retire the handoff — only an explicit Stop does.
 */
export const AGENT_SESSION_STOPPED_CACHE_KEY = (sessionId: string) => `agent.session.stopped.${sessionId}` as const
