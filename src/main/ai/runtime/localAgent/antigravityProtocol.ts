import type { LocalPermissionOption } from '@shared/ai/localAgent'
import { NativeQuestionReplySchema } from '@shared/ai/nativeInteraction'

const SECURITY_WARNING_META_KEY = 'agy.security.warning'
const WARNING_TEXT_LIMIT = 512

export interface AcpPermissionOptionLike {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
  _meta?: Record<string, unknown> | null
}

export interface AcpPermissionRequestLike {
  toolCall: {
    toolCallId: string
    title?: string | null
    rawInput?: unknown
  }
  options: readonly AcpPermissionOptionLike[]
}

/** Antigravity encodes interactive questions as permission requests prefixed with `interaction_`. */
export function isAntigravityUserInputRequest(request: AcpPermissionRequestLike): boolean {
  return request.toolCall.toolCallId.startsWith('interaction_')
}

/** Build an `AskUserQuestion` payload from an Antigravity `interaction_*` permission request. */
export function buildAntigravityUserInputRequest(request: AcpPermissionRequestLike): Record<string, unknown> {
  const raw =
    request.toolCall.rawInput &&
    typeof request.toolCall.rawInput === 'object' &&
    !Array.isArray(request.toolCall.rawInput)
      ? (request.toolCall.rawInput as Record<string, unknown>)
      : undefined
  const questionText =
    (typeof raw?.prompt === 'string' && raw.prompt.trim()) ||
    (typeof raw?.question === 'string' && raw.question.trim()) ||
    request.toolCall.title?.trim() ||
    'Question'
  const options = request.options.map((option) => ({
    label: (option.name.trim() || option.optionId).slice(0, WARNING_TEXT_LIMIT)
  }))
  return {
    questions: [
      {
        id: request.toolCall.toolCallId,
        question: questionText,
        header: 'Question',
        multiSelect: false,
        options
      }
    ],
    responseMode: 'native-request'
  }
}

/** Map a submitted `AskUserQuestion` answer back to the matching ACP permission `optionId`. */
export function resolveAntigravityUserInputOptionId(
  request: AcpPermissionRequestLike,
  approved: boolean,
  updatedInput?: Record<string, unknown>
): string | undefined {
  if (!approved || !updatedInput) return undefined
  let candidate: string | undefined
  const parsed = NativeQuestionReplySchema.safeParse(updatedInput)
  if (parsed.success && parsed.data.action === 'submit') {
    const first = parsed.data.selections[0]
    candidate = first?.selected[0] ?? first?.notes?.trim()
  }
  if (
    !candidate &&
    updatedInput.answers &&
    typeof updatedInput.answers === 'object' &&
    !Array.isArray(updatedInput.answers)
  ) {
    const values = Object.values(updatedInput.answers as Record<string, unknown>)
    const first = values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    candidate = first?.trim()
  }
  if (!candidate) return undefined
  const exact = request.options.find((option) => option.optionId === candidate)
  if (exact) return exact.optionId
  const labelMatches = request.options.filter(
    (option) => (option.name.trim() || option.optionId).slice(0, WARNING_TEXT_LIMIT) === candidate
  )
  return labelMatches.length === 1 ? labelMatches[0].optionId : undefined
}

/** Extract Antigravity's `agy.security.warning` metadata text from an ACP permission option. */
export function extractAntigravitySecurityWarning(option: AcpPermissionOptionLike): string | undefined {
  const meta = option._meta
  if (!meta || typeof meta !== 'object') return undefined
  const warning = meta[SECURITY_WARNING_META_KEY]
  if (!warning || typeof warning !== 'object' || Array.isArray(warning)) return undefined
  const record = warning as Record<string, unknown>
  const message = typeof record.message === 'string' ? record.message.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const text = message || title
  if (!text) return undefined
  return text.length > WARNING_TEXT_LIMIT ? `${text.slice(0, WARNING_TEXT_LIMIT - 3)}...` : text
}

/** Map ACP permission options onto Cherry Studio's protocol-agnostic `LocalPermissionOption` list. */
export function mapAcpPermissionOptions(
  options: readonly AcpPermissionOptionLike[],
  { isAntigravity, hostAllowSessionOptionId }: { isAntigravity: boolean; hostAllowSessionOptionId: string }
): LocalPermissionOption[] {
  const mapped: LocalPermissionOption[] = options.map((option) => {
    const warning = isAntigravity ? extractAntigravitySecurityWarning(option) : undefined
    if (option.kind === 'allow_once') {
      const trimmed = option.name.trim()
      return {
        optionId: option.optionId,
        decision: 'accept',
        label: /^allow once$/i.test(trimmed) ? 'allow_once' : /^allow$/i.test(trimmed) ? 'allow' : undefined,
        name: option.name,
        ...(warning ? { warning } : {})
      }
    }
    if (option.kind === 'allow_always') {
      const trimmed = option.name.trim()
      // Antigravity scopes allow_always to the thread/session rather than permanently.
      const isSessionScoped = isAntigravity || /^allow for (?:this )?session$/i.test(trimmed)
      const isGenericAlways = /^(?:always allow|allow always)(?:\s*\(risky\))?$/i.test(trimmed)
      return {
        optionId: option.optionId,
        decision: isSessionScoped ? 'acceptForSession' : 'acceptAlways',
        label: isSessionScoped ? 'allow_session' : isGenericAlways ? 'allow_always' : undefined,
        name: option.name,
        ...(warning ? { warning } : {})
      }
    }
    if (option.kind === 'reject_once') {
      return {
        optionId: option.optionId,
        decision: 'decline',
        label: /^(?:reject|deny)$/i.test(option.name.trim()) ? 'deny' : undefined,
        name: option.name
      }
    }
    return {
      optionId: option.optionId,
      decision: 'decline',
      name: option.name
    }
  })

  const hasAlways = options.some((option) => option.kind === 'allow_always')
  const allowOnceIndex = mapped.findIndex((option) => option.decision === 'accept')
  if (!hasAlways && allowOnceIndex >= 0) {
    mapped.splice(allowOnceIndex + 1, 0, {
      optionId: hostAllowSessionOptionId,
      decision: 'acceptForSession',
      label: 'allow_session',
      name: 'Allow for session'
    })
  }

  return mapped
}
