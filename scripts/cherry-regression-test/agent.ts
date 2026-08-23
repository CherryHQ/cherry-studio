import type { TaskId } from './types'

interface AgentPreflightOutput {
  api_error_status?: number
  errors?: string[]
  is_error?: boolean
  num_turns?: number
  result?: string
  subtype?: string
  terminal_reason?: string
}

const TASK_SKILL_SECTION: Record<TaskId, number | null> = {
  'startup-smoke': null,
  'mini-app': 18,
  notes: 21,
  'cherryin-chat': 5,
  'custom-provider-chat': 6,
  'custom-assistant': 7,
  'skill-import': 14,
  'quick-assistant': 8,
  'selection-assistant': 10,
  'knowledge-import': 9,
  'knowledge-qa': 11,
  'everything-mcp': 12,
  'pi-runtime': 15,
  'deepseek-harness-runtime': 15,
  'claude-agent-runtime': 15,
  'agent-ppt': 13,
  translation: 17,
  'image-generation': 16,
  'code-cli': 19,
  openclaw: 20
}

const COMMON_SKILL_SECTIONS = new Set([1, 2, 3, 4, 22, 23, 24, 25, 26])
const EXECUTION_HEADING = '## Execute the assigned task'
const BOUNDED_HEADING = '## Keep execution bounded'

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

export function buildTaskSkillInstructions(source: string, task: TaskId): string {
  const executionIndex = source.indexOf(EXECUTION_HEADING)
  const boundedIndex = source.indexOf(BOUNDED_HEADING)
  if (executionIndex < 0 || boundedIndex <= executionIndex)
    throw new Error('Regression skill has invalid task sections')

  const preamble = source
    .slice(0, executionIndex)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .trim()
  const execution = source.slice(executionIndex + EXECUTION_HEADING.length, boundedIndex)
  const matches = [...execution.matchAll(/^(\d+)\. /gm)]
  const sections = matches.map((match, index) => ({
    number: Number(match[1]),
    text: execution.slice(match.index, matches[index + 1]?.index ?? execution.length).trim()
  }))
  const taskSection = TASK_SKILL_SECTION[task]
  const selectedNumbers = new Set(COMMON_SKILL_SECTIONS)
  if (taskSection !== null) selectedNumbers.add(taskSection)
  const selected = sections.filter(({ number }) => selectedNumbers.has(number))
  if (selected.length !== selectedNumbers.size) throw new Error('Regression skill is missing a required task section')

  return [preamble, EXECUTION_HEADING, selected.map(({ text }) => text).join('\n'), source.slice(boundedIndex).trim()]
    .join('\n\n')
    .concat('\n')
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

export function isRetryableAgentFailure(result: AgentProcessResult): boolean {
  if (result.error?.message.includes('ETIMEDOUT')) return true

  let output: AgentPreflightOutput
  try {
    output = parseAgentOutput(result.stdout)
  } catch {
    return false
  }

  if (output.subtype === 'error_max_turns') return true
  if (output.api_error_status === 429) return true
  return output.terminal_reason === 'api_error' && /(?:\b429\b|quota exceeded)/i.test(output.result ?? '')
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
    const resultDetail = output.result?.trim()
    return detail
      ? `returned an error: ${detail}`
      : resultDetail
        ? `returned an error: ${resultDetail}`
        : 'returned an error result'
  }
  if (result.signal) return `terminated by ${result.signal}`
  if (result.status !== 0) return `exited with status ${result.status ?? 'unknown'}`
  if (!output) return 'returned invalid JSON'
  return undefined
}
