interface AgentPreflightOutput {
  errors?: string[]
  is_error?: boolean
  num_turns?: number
  result?: string
  subtype?: string
}

export interface AgentProcessResult {
  error?: { message: string }
  signal: NodeJS.Signals | null
  status: number | null
  stdout: string
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

export function assertAgentTaskOutput(output: string): void {
  const result = parseAgentOutput(output)
  if (result.is_error !== false) throw new Error('Test agent task returned an error result')
}

export function describeAgentFailure(
  result: AgentProcessResult,
  limits: { timeoutMinutes: number }
): string | undefined {
  if (result.error?.message.includes('ETIMEDOUT')) return `timed out after ${limits.timeoutMinutes} minutes`

  let output: AgentPreflightOutput | undefined
  try {
    output = parseAgentOutput(result.stdout)
  } catch {
    output = undefined
  }

  if (output?.subtype === 'error_max_turns') {
    return output.num_turns
      ? `reached maximum number of turns (${output.num_turns})`
      : 'reached maximum number of turns'
  }
  if (output?.is_error) {
    const detail = output.errors?.filter(Boolean).join('; ')
    return detail ? `returned an error: ${detail}` : 'returned an error result'
  }
  if (result.signal) return `terminated by ${result.signal}`
  if (result.status !== 0) return `exited with status ${result.status ?? 'unknown'}`
  if (!output) return 'returned invalid JSON'
  return undefined
}
