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
  'bad_request',
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
      return '/app/knowledge'
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

/** `statusCode` or `status`, numeric or a numeric string. Unparseable values count as absent. */
function readStructuredStatus(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = record.statusCode ?? record.status
  const parsed = typeof status === 'number' ? status : typeof status === 'string' ? parseInt(status, 10) : undefined
  return typeof parsed === 'number' && !Number.isNaN(parsed) ? parsed : undefined
}

/**
 * The model / provider ids from a locally raised resolution failure ("Cannot resolve modelId…").
 * Main rejects those before any provider call, so the ids are the only layer detail the user can
 * act on — a provider 404 body already names the model in its own text. Null for anything else.
 */
export function getLocalModelResolutionFailure(
  error?: SerializedError
): { providerId?: string; modelId?: string } | null {
  const message = typeof error?.message === 'string' ? error.message : ''

  // AiService cannot supply an identifier when neither the request nor assistant has a model.
  // Keep the local failure recognizable without treating the word "not" as a model ID.
  if (/^Cannot resolve (?:providerId|modelId): not in request and assistant has no model$/.test(message)) {
    return {}
  }

  // Format 1: "Cannot resolve modelId: <id>" or "Cannot resolve providerId: <id>"
  if (/^Cannot resolve (?:providerId|modelId)/.test(message)) {
    const prefixMatch = /^Cannot resolve (?:providerId|modelId):\s*([^,\s]+)/.exec(message)
    if (prefixMatch) {
      return { modelId: prefixMatch[1] }
    }

    // Format 2: "Cannot resolve modelId="..."" or "Cannot resolve providerId="..."" (quoted)
    const providerId = /providerId="([^"]+)"/.exec(message)?.[1]
    const modelId = /modelId="([^"]+)"/.exec(message)?.[1]
    if (modelId) return { providerId, modelId }

    // Format 3: "[model1,model2,model3]" list format
    const list = /\[([^\]]*)\]/.exec(message)
    if (list) {
      const m = list[1]
        .split(',')
        .map((id) => id.trim())
        .find(Boolean)
      return m ? { modelId: m } : null
    }

    return null
  }

  // Format 4: "Model with id 'provider/model' not found" (DataApiErrorFactory.notFound)
  const modelIdMatch = /^Model with id '([^']+)' not found$/.exec(message)
  if (modelIdMatch) {
    return { modelId: modelIdMatch[1] }
  }

  return null
}

/**
 * A status-less RetryError copies the terminal phrase. Return that attempt's HTTP 5xx;
 * earlier attempts do not supply a status.
 */
export function getErrorHttpStatus(error: SerializedError): number | undefined {
  const outer = readStructuredStatus(error)
  if (outer !== undefined) return outer
  if (!isSerializedAiSdkRetryError(error)) return undefined
  const terminalStatus = readStructuredStatus(error.lastError)
  return terminalStatus !== undefined && terminalStatus >= 500 && terminalStatus < 600 ? terminalStatus : undefined
}

export function classifyError(error?: SerializedError, providerId?: string): ErrorClassification {
  const providerSuffix = providerId ? `?id=${encodeURIComponent(providerId)}` : ''
  const classify = (category: ErrorCategory): ErrorClassification => ({
    category,
    i18nKey: `error.diagnosis.${category}`,
    navTarget: navTargetFor(category, providerSuffix)
  })

  if (!error) return classify('unknown')

  const claudeCodeExitCategory = getClaudeCodeExitCategory(error)
  if (claudeCodeExitCategory) return classify(claudeCodeExitCategory)

  const errorBag = error as Record<string, unknown>
  if (isErrorCategory(errorBag.providerErrorCategory) && errorBag.providerErrorCategory !== 'unknown') {
    return classify(errorBag.providerErrorCategory)
  }
  // Checked before text classification: the unknown-text fallback would reclassify this local
  // resolution failure as `bad_request` ("请求错误… If you changed model settings, reset them").
  if (getLocalModelResolutionFailure(error)) return classify('model')
  const numStatus = getErrorHttpStatus(error)

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
  if (category !== 'unknown' && category !== 'bad_request') return classify(category)

  // Prefer a specific diagnosis over a generic request failure in another attempt.
  let nestedRecovery: ErrorClassification | null = null
  for (const nested of unwrapNestedErrors(error)) {
    const nestedClassification = classifyError(nested, providerId)
    if (nestedClassification.category !== 'unknown' && nestedClassification.category !== 'bad_request') {
      return nestedClassification
    }
    if (!nestedRecovery && nestedClassification.navTarget) nestedRecovery = nestedClassification
  }
  if (nestedRecovery) return nestedRecovery

  return classify(category)
}
