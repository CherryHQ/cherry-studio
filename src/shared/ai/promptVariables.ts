export const VOLATILE_PROMPT_VARIABLES = ['{{time}}', '{{datetime}}'] as const

const SUPPORTED_VARIABLES = [
  '{{username}}',
  '{{date}}',
  ...VOLATILE_PROMPT_VARIABLES,
  '{{system}}',
  '{{language}}',
  '{{arch}}',
  '{{model_name}}'
] as const

type PromptVariableValue = string | null | undefined

/** Process-specific readers for the variables whose value lives outside the prompt itself. */
export interface PromptVariableSources {
  username: () => PromptVariableValue | Promise<PromptVariableValue>
  /** `mac`, `windows` or `linux`. */
  system: () => PromptVariableValue | Promise<PromptVariableValue>
  language: () => PromptVariableValue | Promise<PromptVariableValue>
  arch: () => PromptVariableValue | Promise<PromptVariableValue>
  onError?: (variable: string, error: unknown) => void
}

const SOURCED_VARIABLES = [
  ['{{username}}', 'username', 'Unknown Username'],
  ['{{system}}', 'system', 'Unknown System'],
  ['{{language}}', 'language', 'Unknown System Language'],
  ['{{arch}}', 'arch', 'Unknown Architecture']
] as const

export const containsSupportedVariables = (prompt: string): boolean =>
  SUPPORTED_VARIABLES.some((variable) => prompt.includes(variable))

export async function replacePromptVariables(
  prompt: string,
  modelName: string | undefined,
  sources: PromptVariableSources
): Promise<string> {
  if (typeof prompt !== 'string') return prompt

  const now = new Date()

  if (prompt.includes('{{date}}')) {
    const date = now.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    })
    prompt = prompt.replaceAll('{{date}}', date)
  }

  if (prompt.includes('{{time}}')) {
    prompt = prompt.replaceAll('{{time}}', now.toLocaleTimeString())
  }

  if (prompt.includes('{{datetime}}')) {
    const datetime = now.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
    prompt = prompt.replaceAll('{{datetime}}', datetime)
  }

  for (const [variable, source, fallback] of SOURCED_VARIABLES) {
    if (!prompt.includes(variable)) continue
    let value: PromptVariableValue
    try {
      value = await sources[source]()
    } catch (error) {
      sources.onError?.(variable, error)
    }
    prompt = prompt.replaceAll(variable, value || fallback)
  }

  if (prompt.includes('{{model_name}}')) {
    prompt = prompt.replaceAll('{{model_name}}', modelName ?? 'Unknown Model')
  }

  return prompt
}
