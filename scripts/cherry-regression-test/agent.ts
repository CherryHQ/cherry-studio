interface AgentPreflightOutput {
  is_error?: boolean
  result?: string
}

export function assertAgentPreflightOutput(output: string, marker: string): void {
  let result: AgentPreflightOutput
  try {
    result = JSON.parse(output) as AgentPreflightOutput
  } catch {
    throw new Error('Agent preflight did not return JSON')
  }
  if (result.is_error) throw new Error('Agent preflight returned an error result')
  if (result.result?.trim() !== marker) throw new Error('Agent preflight returned an unexpected response')
}
