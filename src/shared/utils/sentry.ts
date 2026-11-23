import type { ErrorEvent } from '@sentry/electron/renderer'
import { prerelease } from 'semver'

import type { AppEdition } from '../types/appEdition'
import { hasReportingOwner, isCancellation, parseFailureFacts, shouldReportFailure } from './errorReporting'
import { isSensitiveKey, redactSecretText } from './redaction'

export function getSentryBuildContext(name: string, version: string, edition: AppEdition) {
  return {
    release: `${name}@${version}`,
    tags: {
      'app.version': version,
      'app.edition': edition,
      'app.channel': String(prerelease(version)?.[0] ?? 'stable')
    }
  }
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Log entries carry arbitrary error/context values; failure facts and selected report tags are validated below.
export function getSentryLogContext(info: Record<string, unknown>) {
  const data = Array.isArray(info.data) ? info.data : []
  const failure = parseFailureFacts(info.failure ?? data.find((item) => item?.failure)?.failure)

  if (!failure) return

  if (['Sentry', 'CrashTelemetry', 'ErrorReportingService'].includes(String(info.module))) return

  if (isCancellation(info) || hasReportingOwner(info) || (failure && !shouldReportFailure(failure))) return

  const tags: Record<string, string> = {}

  if (failure) {
    for (const [key, value] of Object.entries(failure)) tags[`failure.${key}`] = value
  }

  for (const key of ['module', 'window', 'code'] as const) {
    if (typeof info[key] === 'string') tags[key] = info[key]
  }

  if (info.process === 'main' || info.process === 'renderer') tags['event.process'] = info.process

  const operation =
    info.operation ??
    (Array.isArray(info.data)
      ? info.data.find((item) => item && typeof item.operation === 'string')?.operation
      : undefined)

  if (typeof operation === 'string' && /^[a-z][a-z0-9_.-]{0,79}$/i.test(operation)) tags.operation = operation

  const componentStack = Array.isArray(info.data)
    ? info.data.find((item) => item && typeof item.componentStack === 'string')?.componentStack
    : undefined

  return { tags, extra: componentStack ? { componentStack } : undefined }
}

/** For SDK beforeSend payloads; processing metadata stays under SDK ownership. */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  const { sdkProcessingMetadata, ...payload } = event

  // SAFETY: The SDK beforeSend producers supply finite numeric fields and closed literals unchanged by text redaction.
  // Sensitive optional/dictionary fields are omitted; the undefined discriminator and opaque SDK metadata bypass JSON projection.
  const sanitized = JSON.parse(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON serialization supplies arbitrary property and toJSON values; only strings and sensitive key names are interpreted here.
    JSON.stringify(payload, (key, value: unknown) => {
      if (isSensitiveKey(key)) return undefined

      return typeof value === 'string' ? redactSecretText(value, ['code']) : value
    })
  ) as Omit<ErrorEvent, 'type' | 'sdkProcessingMetadata'>

  return { ...sanitized, type: undefined, sdkProcessingMetadata }
}
