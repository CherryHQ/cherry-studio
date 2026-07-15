export class AgentSessionWorkspaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSessionWorkspaceError'
  }
}

export function isAgentSessionWorkspaceError(error: unknown): error is AgentSessionWorkspaceError {
  return error instanceof AgentSessionWorkspaceError
}
