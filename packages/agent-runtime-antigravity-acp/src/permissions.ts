import type { AcpHarnessAdapter, AcpPermissionOption } from '@cherrystudio/agent-runtime-acp/v1'

const SECURITY_WARNING_META_KEY = 'agy.security.warning'
const OPTION_TEXT_LIMIT = 512

function securityWarning(option: AcpPermissionOption): string | undefined {
  const warning = option._meta?.[SECURITY_WARNING_META_KEY]
  if (!warning || typeof warning !== 'object' || Array.isArray(warning)) return undefined
  const { message, title } = warning as Record<string, unknown>
  const text = (typeof message === 'string' && message.trim()) || (typeof title === 'string' && title.trim())
  if (!text) return undefined
  return text.length > OPTION_TEXT_LIMIT ? `${text.slice(0, OPTION_TEXT_LIMIT - 3)}...` : text
}

export const antigravityPermissions = {
  permissionQuestion({ toolCall, options }) {
    if (!toolCall.toolCallId.startsWith('interaction_')) return undefined
    const raw = toolCall.rawInput
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined
    const text =
      (typeof input?.prompt === 'string' && input.prompt.trim()) ||
      (typeof input?.question === 'string' && input.question.trim()) ||
      toolCall.title?.trim() ||
      'Question'
    const choices = options.map(({ name, optionId }) => ({
      label: (name.trim() || optionId).slice(0, OPTION_TEXT_LIMIT),
      optionId
    }))
    return {
      text,
      options: choices.map(({ label }) => ({ label })),
      optionIdFor(answer: string) {
        const exact = choices.find(({ optionId }) => optionId === answer)
        if (exact) return exact.optionId
        const matches = choices.filter(({ label }) => label === answer)
        return matches.length === 1 ? matches[0].optionId : undefined
      }
    }
  },
  describePermissionOption(option) {
    return { scope: option.kind === 'allow_always' ? 'session' : undefined, warning: securityWarning(option) }
  }
} satisfies Required<Pick<AcpHarnessAdapter, 'permissionQuestion' | 'describePermissionOption'>>
