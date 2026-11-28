import type { SerializedError } from '@renderer/types/error'
import {
  classifyExecutionError,
  getErrorHttpStatus,
  getLocalModelResolutionFailure,
  isClassifiedExecutionError,
  isCodexUnsupportedModelError,
  unwrapNestedExecutionErrors
} from '@shared/ai/executionError'
import { getSafeProviderErrorMessage } from '@shared/ai/providerError'
import { type ErrorCategory, isErrorCategory } from '@shared/utils/errorCategory'

export { getErrorHttpStatus, getLocalModelResolutionFailure }
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

export function isUnattributedClaudeCodeExit(error?: SerializedError): boolean {
  const exit = getClaudeCodeExitInfo(error)
  if (!exit || exit.category !== 'unknown' || !exit.reference.trim()) return false

  if (exit.exitCode !== undefined) return Number.isSafeInteger(exit.exitCode) && exit.exitCode !== 0
  return error?.processExitCode == null && !!exit.exitSignal?.trim()
}

export function getProviderAuthenticationFailure(error?: SerializedError): { providerId: string } | null {
  if (!error) return null
  if (error.i18nKey === 'chat.provider_sign_in_required' && typeof error.providerId === 'string') {
    return { providerId: error.providerId }
  }
  // ACP agents may preserve only the gateway's error text when wrapping an HTTP response.
  const text = getSafeProviderErrorMessage(error)
  const providerId = /Authentication required for provider "([^"\r\n]+)"\./.exec(text)?.[1]
  if (providerId) return { providerId }
  const terminal = unwrapNestedExecutionErrors(error)[0]
  return terminal ? getProviderAuthenticationFailure(terminal) : null
}

function isLocalAgentHostRequiredError(error: SerializedError): boolean {
  if ((error as Record<string, unknown>).code === 'LOCAL_AGENT_HOST_REQUIRED') return true
  const cause = (error as Record<string, unknown>).cause
  if (
    cause &&
    typeof cause === 'object' &&
    !Array.isArray(cause) &&
    isLocalAgentHostRequiredError(cause as SerializedError)
  ) {
    return true
  }
  if (unwrapNestedExecutionErrors(error).some((nested) => isLocalAgentHostRequiredError(nested))) {
    return true
  }
  const message = (error.message ?? '').trim()
  return (
    /^(?:(?:IpcError|Error):\s*)*[\w .-]+\s+requires\s+(?:ZCode Desktop \/ zcode CLI|amp CLI)\s+to be installed\b/i.test(
      message
    ) || /^(?:(?:IpcError|Error):\s*)*[\w .-]+\s+需要先安装\s+(?:ZCode Desktop \/ zcode CLI|amp CLI)/i.test(message)
  )
}

function isLocalAgentAuthenticationMessage(error: SerializedError): boolean {
  const message = (error.message ?? '').trim()
  if (!message) return false
  if (/api.?key/i.test(message)) return false
  return /^(?:(?:IpcError|Error):\s*)*(?:Authentication required|No authentication method selected)\b/i.test(message)
}

export function classifyError(error?: SerializedError, providerId?: string): ErrorClassification {
  const resolved = error && isClassifiedExecutionError(error) ? error.executionErrorCategory : undefined
  const authentication = resolved === undefined || resolved === 'auth' ? getProviderAuthenticationFailure(error) : null
  if (authentication) {
    return {
      category: 'auth',
      i18nKey: 'error.chat.provider_sign_in_required',
      navTarget: `/settings/provider?id=${encodeURIComponent(authentication.providerId)}`
    }
  }
  const providerSuffix = providerId ? `?id=${encodeURIComponent(providerId)}` : ''
  const classify = (category: ErrorCategory): ErrorClassification => ({
    category,
    i18nKey: `error.diagnosis.${category}`,
    navTarget: navTargetFor(category, providerSuffix)
  })

  if (!error || error.errorSource === 'local') return classify('unknown')

  if ((resolved === undefined || resolved === 'model') && isCodexUnsupportedModelError(error)) {
    return {
      category: 'model',
      i18nKey: 'error.diagnosis.codex_model_unsupported',
      navTarget: '/settings/local-agents?id=codex'
    }
  }

  if (
    (resolved === undefined || resolved === 'unknown') &&
    !providerId &&
    getErrorHttpStatus(error) === undefined &&
    isLocalAgentHostRequiredError(error)
  ) {
    return {
      category: 'unknown',
      i18nKey: 'error.diagnosis.local_agent_host_required',
      navTarget: '/settings/provider'
    }
  }

  if (
    (resolved === undefined || resolved === 'auth') &&
    !providerId &&
    getErrorHttpStatus(error) === undefined &&
    isLocalAgentAuthenticationMessage(error)
  ) {
    return {
      category: 'auth',
      i18nKey: 'error.diagnosis.local_agent_auth',
      navTarget: '/settings/provider'
    }
  }

  const category = classifyExecutionError(error)
  if (category === 'model') {
    const localFailure = getLocalModelResolutionFailure(error)
    if (localFailure?.providerId && !localFailure.modelId) {
      return { ...classify(category), navTarget: '/settings/provider' }
    }
  }
  return classify(category)
}
