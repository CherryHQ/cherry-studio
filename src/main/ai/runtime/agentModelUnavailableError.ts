/**
 * An Agent model row still exists but cannot be served right now (provider or model disabled,
 * unroutable through the API gateway). Distinct from deleted rows: a warm connection must not
 * be silently invalidated for it, but rebuilt so the cold path reports this message to the turn.
 */
export class AgentModelUnavailableError extends Error {
  override readonly name = 'AgentModelUnavailableError'
}

export function isAgentModelUnavailableError(error: unknown): error is AgentModelUnavailableError {
  return error instanceof AgentModelUnavailableError
}
