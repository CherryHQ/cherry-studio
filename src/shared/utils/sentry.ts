import { prerelease } from 'semver'

import type { AppEdition } from '../types/appEdition'
import { hasReportingOwner, isCancellation, parseFailureFacts, shouldReportFailure } from './errorReporting'
import { isSensitiveKey, REDACTED, redactSecretText } from './redaction'

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

export function getSentryLogContext(info: Record<string, unknown>) {
  const data = Array.isArray(info.data) ? info.data : []
  const failure = parseFailureFacts(info.failure ?? data.find((item) => item?.failure)?.failure)
  if (!failure && (info.level !== 'error' || typeof info.stack !== 'string')) return
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

export function sanitizeSentryEvent<T>(event: T): T {
  return JSON.parse(
    JSON.stringify(event, (key, value) => {
      if (isSensitiveKey(key)) return REDACTED
      return typeof value === 'string' ? redactSecretText(value, ['code']) : value
    })
  ) as T
}
