interface AgentPreflightOutput {
  is_error?: boolean
  result?: string
}

function parseAgentOutput(output: string): AgentPreflightOutput {
  let result: unknown
  try {
    result = JSON.parse(output) as unknown
  } catch {
    throw new Error('Test agent did not return JSON')
  }
  if (!result || typeof result !== 'object') throw new Error('Test agent returned invalid JSON')
  return result as AgentPreflightOutput
}

export function assertAgentPreflightOutput(output: string, marker: string): void {
  const result = parseAgentOutput(output)
  if (result.is_error !== false) throw new Error('Agent preflight returned an error result')
  if (result.result?.trim() !== marker) throw new Error('Agent preflight returned an unexpected response')
}

export function assertAgentSuiteOutput(output: string): void {
  const result = parseAgentOutput(output)
  if (result.is_error !== false) throw new Error('Test agent suite returned an error result')
}
