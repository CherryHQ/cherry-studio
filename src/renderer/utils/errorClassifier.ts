import type { SerializedError } from '@renderer/types/error'
import { isSerializedAiSdkRetryError, isSerializedAiSdkToolCallRepairError } from '@renderer/types/error'
import { classifyErrorCategory, type ErrorCategory, isErrorCategory } from '@shared/utils/errorCategory'

export type { ErrorCategory } from '@shared/utils/errorCategory'

export interface ErrorClassification {
  category: ErrorCategory
  i18nKey: string
  navTarget: string | null
}

/** Claude Code process exit surfaced by the main process; see `processExitDiagnostics`. */
export interface ClaudeCodeExitInfo {
  category: ErrorCategory
  reference: string
  exitCode?: number
  exitSignal?: string
}

const PROVIDER_SETTINGS_CATEGORIES: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'auth',
  'permission',
  'model',
  'quota',
  'rate_limit',
  'deprecated'
])

function navTargetFor(category: ErrorCategory, providerSuffix: string): string | null {
  if (PROVIDER_SETTINGS_CATEGORIES.has(category)) return `/settings/provider${providerSuffix}`
  switch (category) {
    case 'region':
    case 'network':
    case 'proxy':
      return '/settings/general'
    case 'mcp':
      return '/settings/mcp/servers'
    case 'knowledge':
      return '/knowledge'
    default:
      return null
  }
}

/**
 * The category the main process already derived from the subprocess's stderr. The renderer
 * cannot re-derive it: the message crossing IPC is sanitized down to the exit status.
 */
export function getClaudeCodeExitCategory(error?: SerializedError): ErrorCategory | undefined {
  const category = (error as Record<string, unknown> | undefined)?.claudeCodeExitCategory
  return isErrorCategory(category) ? category : undefined
}

/** Display payload for a Claude Code exit; absent unless the reference that logs it survived. */
export function getClaudeCodeExitInfo(error?: SerializedError): ClaudeCodeExitInfo | undefined {
  const category = getClaudeCodeExitCategory(error)
  const errorBag = error as Record<string, unknown> | undefined
  const reference = errorBag?.diagnosticReference
  if (!category || typeof reference !== 'string' || !reference) return undefined

  return {
    category,
    reference,
    ...(typeof errorBag?.processExitCode === 'number' ? { exitCode: errorBag.processExitCode } : {}),
    ...(typeof errorBag?.processExitSignal === 'string' ? { exitSignal: errorBag.processExitSignal } : {})
  }
}

/**
 * Errors nested inside a serialized AI SDK wrapper. `serializeError` drops non-enumerable
 * `message`/`stack` from them, so they are partial — only shape-tolerant readers may use them.
 */
function unwrapNestedErrors(error: SerializedError): SerializedError[] {
  const nested = isSerializedAiSdkRetryError(error)
    ? [error.lastError, ...error.errors]
    : isSerializedAiSdkToolCallRepairError(error)
      ? [error.originalError]
      : []

  return nested.filter(
    (candidate): candidate is SerializedError =>
      typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
  )
}

export function classifyError(error?: SerializedError, providerId?: string): ErrorClassification {
  const providerSuffix = providerId ? `?id=${providerId}` : ''
  const classify = (category: ErrorCategory): ErrorClassification => ({
    category,
    i18nKey: `error.diagnosis.${category}`,
    navTarget: navTargetFor(category, providerSuffix)
  })

  if (!error) return classify('unknown')

  const claudeCodeExitCategory = getClaudeCodeExitCategory(error)
  if (claudeCodeExitCategory) return classify(claudeCodeExitCategory)

  const errorBag = error as Record<string, unknown>
  const status = errorBag.statusCode ?? errorBag.status
  const numStatus = typeof status === 'number' ? status : typeof status === 'string' ? parseInt(status, 10) : undefined

  const responseBodyText = typeof errorBag.responseBody === 'string' ? errorBag.responseBody : ''
  let dataText = ''
  if (errorBag.data !== undefined && errorBag.data !== null) {
    try {
      dataText = typeof errorBag.data === 'string' ? errorBag.data : JSON.stringify(errorBag.data)
    } catch {
      // Ignore non-serializable provider data.
    }
  }

  const category = classifyErrorCategory({
    text: [error.message ?? '', responseBodyText, dataText].filter(Boolean).join('\n'),
    status: numStatus,
    finishReason: String(errorBag.finishReason ?? '')
  })
  if (category !== 'unknown') return classify(category)

  // A wrapper carries no status of its own — diagnose the first attempt that says something.
  for (const nested of unwrapNestedErrors(error)) {
    const nestedClassification = classifyError(nested, providerId)
    if (nestedClassification.category !== 'unknown') {
      return nestedClassification
    }
  }

  return classify('unknown')
}
