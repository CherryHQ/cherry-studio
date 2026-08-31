import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { SerializedError } from '@renderer/types/error'
import { providerErrorText, serializeHealthCheckError } from '@renderer/utils/error'
import {
  getModelOperationCapabilities,
  type Model,
  MODEL_CAPABILITY,
  type UniqueModelId
} from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { isLoginBasedProvider } from '@shared/utils/provider'

import type {
  ApiKeyWithStatus,
  ModelCheckCredential,
  ModelCheckCredentialPolicy,
  ModelCheckKeySelection,
  ModelCheckOptions,
  ModelHealthCheckSkipReason,
  ModelWithStatus
} from '../types/healthCheck'
import { HealthStatus } from '../types/healthCheck'

export type ModelCheckCredentialsErrorCode = 'api_key_required' | 'api_key_unavailable'

export class ModelCheckCredentialsError extends Error {
  readonly code: ModelCheckCredentialsErrorCode

  constructor(code: ModelCheckCredentialsErrorCode) {
    super(code)
    this.name = 'ModelCheckCredentialsError'
    this.code = code
  }
}

export function getModelCheckCredentialPolicy(
  provider: Pick<Provider, 'authMethods' | 'authOptional'> | undefined,
  isApiKeyFieldVisible: boolean
): ModelCheckCredentialPolicy {
  if (provider === undefined || !isApiKeyFieldVisible || isLoginBasedProvider(provider)) {
    return { canSelectApiKey: false, requiresApiKey: false }
  }

  return { canSelectApiKey: true, requiresApiKey: provider.authOptional !== true }
}

export function resolveModelCheckCredentials(
  apiKeyEntries: readonly ApiKeyEntry[],
  selection: ModelCheckKeySelection,
  policy: ModelCheckCredentialPolicy
): ModelCheckCredential[] {
  if (!policy.canSelectApiKey) {
    return [{ kind: 'provider-auth', id: 'provider-auth', key: '' }]
  }

  const enabledEntries = apiKeyEntries.filter((entry) => entry.isEnabled)

  if (enabledEntries.length === 0) {
    if (policy.requiresApiKey) {
      throw new ModelCheckCredentialsError('api_key_required')
    }
    return [{ kind: 'provider-auth', id: 'provider-auth', key: '' }]
  }

  if (selection.mode === 'single') {
    const selectedEntry = enabledEntries.find((entry) => entry.id === selection.keyId)
    if (!selectedEntry) {
      throw new ModelCheckCredentialsError('api_key_unavailable')
    }
    return [{ kind: 'api-key', entry: selectedEntry }]
  }

  return enabledEntries.map((entry) => ({ kind: 'api-key', entry }))
}

export function healthCheckErrorToDisplayString(error: SerializedError | string | undefined | null): string {
  if (error == null) {
    return ''
  }
  if (typeof error === 'string') {
    return error.trim()
  }
  // `providerErrorText` prefers the provider's own response body — `message` alone is the
  // HTTP statusText ("Forbidden") whenever the body misses the SDK's error schema.
  const msg = providerErrorText(error).trim()
  if (msg) {
    return msg
  }
  const name = error.name?.trim()
  if (name) {
    return name
  }
  return ''
}

export async function checkModelWithMultipleKeys(
  model: ModelCheckOptions['models'][number],
  credentials: ModelCheckCredential[],
  timeout?: number,
  signal?: AbortSignal
): Promise<ApiKeyWithStatus[]> {
  if (credentials.length === 0) return []

  return Promise.all(
    credentials.map(async (credential) => {
      signal?.throwIfAborted()
      try {
        const apiKey = credential.kind === 'api-key' ? credential.entry.key : credential.key
        const { latency } = await checkApi(model.id, { apiKey, timeout, signal })
        return {
          kind: 'ok',
          credential,
          status: HealthStatus.SUCCESS,
          checking: false,
          latency
        } satisfies ApiKeyWithStatus
      } catch (error) {
        return {
          kind: 'failed',
          credential,
          status: HealthStatus.FAILED,
          checking: false,
          error: serializeHealthCheckError(error)
        } satisfies ApiKeyWithStatus
      }
    })
  )
}

export function aggregateApiKeyResults(keyResults: ApiKeyWithStatus[]): {
  status: HealthStatus
  error?: SerializedError
  latency?: number
} {
  const successResults = keyResults.filter((result) => result.status === HealthStatus.SUCCESS)
  const failedResults = keyResults.filter((result) => result.status === HealthStatus.FAILED)

  if (failedResults.length > 0) {
    const errorStrings = failedResults
      .map((result) => healthCheckErrorToDisplayString(result.error))
      .filter((s) => s !== '')
    const errors = [...new Set(errorStrings)].join('; ')

    return {
      status: HealthStatus.FAILED,
      error: errors ? { name: 'HealthCheckError', message: errors, stack: null } : undefined,
      latency: successResults.length > 0 ? Math.min(...successResults.map((result) => result.latency!)) : undefined
    }
  }

  return {
    status: HealthStatus.SUCCESS,
    latency: successResults.length > 0 ? Math.min(...successResults.map((result) => result.latency!)) : undefined
  }
}

export function getModelHealthCheckSkipReason(model: Model): ModelHealthCheckSkipReason | null {
  const operations = getModelOperationCapabilities(model.capabilities)
  const supportsProbe = [
    MODEL_CAPABILITY.TEXT_GENERATION,
    MODEL_CAPABILITY.RERANK,
    MODEL_CAPABILITY.EMBEDDING,
    MODEL_CAPABILITY.IMAGE_GENERATION
  ].some((operation) => operations.includes(operation))
  return supportsProbe ? null : { kind: 'unsupported_probe' }
}

export function summarizeHealthResults(results: ModelWithStatus[], providerName?: string): string {
  const t = i18n.t

  let successCount = 0
  let partialCount = 0
  let failedCount = 0
  let skippedCount = 0

  for (const result of results) {
    if (result.kind === 'skipped') {
      skippedCount++
    } else if (result.status === HealthStatus.SUCCESS) {
      successCount++
    } else if (result.status === HealthStatus.FAILED) {
      const hasSuccessKey = result.keyResults.some((keyResult) => keyResult.status === HealthStatus.SUCCESS)
      if (hasSuccessKey) {
        partialCount++
      } else {
        failedCount++
      }
    }
  }

  const summaryParts: string[] = []
  if (successCount > 0) {
    summaryParts.push(t('settings.models.check.model_status_passed', { count: successCount }))
  }
  if (partialCount > 0) {
    summaryParts.push(t('settings.models.check.model_status_partial', { count: partialCount }))
  }
  if (failedCount > 0) {
    summaryParts.push(t('settings.models.check.model_status_failed', { count: failedCount }))
  }
  if (skippedCount > 0) {
    summaryParts.push(t('settings.models.check.model_status_skipped', { count: skippedCount }))
  }

  if (summaryParts.length === 0) {
    return t('settings.models.check.no_results')
  }

  const summary = summaryParts.join(', ')
  return t('settings.models.check.model_status_summary', {
    provider: providerName ?? t('common.unknown'),
    summary
  })
}

/**
 * Validates that a provider/model pair is working by sending a minimal probe.
 * The renderer only forwards the request; probe dispatch, timeout handling, and
 * latency measurement all happen in Main.
 */
export async function checkApi(
  uniqueModelId: UniqueModelId,
  options?: { apiKey?: string; timeout?: number; signal?: AbortSignal }
): Promise<{ latency: number }> {
  options?.signal?.throwIfAborted()
  return await ipcApi.request('ai.provider.model.check', {
    apiKeyOverride: options?.apiKey,
    uniqueModelId,
    timeout: options?.timeout ?? 15000
  })
}
