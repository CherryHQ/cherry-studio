import { createHash, randomUUID } from 'node:crypto'

import type { ErrorEvent, EventHint } from '@sentry/electron/main'
import { LRUCache } from 'lru-cache'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isDataCollectionConsented } from '@main/utils/privacyConsent'
import { hasReportingOwner, isCancellation, parseFailureFacts, shouldReportFailure } from '@shared/utils/errorReporting'

import { captureLoggedError } from './sentry'

const WINDOW_MS = 10 * 60 * 1000
const logger = loggerService.withContext('ErrorReportingService')

@Injectable('ErrorReportingService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['PreferenceService'])
export class ErrorReportingService extends BaseService {
  private observed = new WeakSet<Error>()
  private readonly buckets = new LRUCache<string, { count: number; expires: number }>({ max: 256 })
  private total = { count: 0, expires: 0 }

  get enabled(): boolean {
    const preferences = application.getExisting('PreferenceService')
    return (
      !import.meta.env.DEV &&
      this.isReady &&
      !!preferences?.isReady &&
      isDataCollectionConsented(
        preferences.get('app.privacy.data_collection.enabled'),
        preferences.get('app.privacy.policy_version')
      )
    )
  }

  protected onInit(): void {
    if (import.meta.env.DEV) return
    this.registerDisposable(
      loggerService.setErrorReporter(({ error, entry }) => {
        if (!this.enabled) return
        if (error && this.observed.has(error)) return
        if (error) this.observed.add(error)
        try {
          captureLoggedError(entry)
        } catch (error) {
          logger.warn('Failed to capture error report', error as Error)
        }
      })
    )
    this.registerDisposable(() => {
      this.observed = new WeakSet()
      this.buckets.clear()
      this.total = { count: 0, expires: 0 }
    })
  }

  filterEvent(event: ErrorEvent, hint: EventHint = {}): ErrorEvent | null {
    if (!this.enabled) return null
    if (hasReportingOwner(hint.originalException) || isCancellation(hint.originalException)) return null
    if (
      event.tags?.['capture.source'] !== 'log' &&
      hint.originalException instanceof Error &&
      this.observed.has(hint.originalException)
    )
      return null
    if (isCancellation({ name: event.exception?.values?.at(-1)?.type })) return null

    const tags = event.tags ?? {}
    const facts = parseFailureFacts({
      source: tags['failure.source'],
      kind: tags['failure.kind'],
      reason: tags['failure.reason'],
      outcome: tags['failure.outcome'],
      runtime: tags['failure.runtime']
    })
    if (facts && !shouldReportFailure(facts)) return null
    const unknown = facts?.kind === 'unknown' || (!facts && tags['capture.source'] === 'log')
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          tags.module,
          tags.operation,
          facts?.source,
          facts?.reason,
          facts?.runtime,
          event.exception?.values?.map((value) => [value.type, value.stacktrace?.frames?.slice(-5)])
        ])
      )
      .digest('hex')
    const now = Date.now()
    if (this.total.expires <= now) this.total = { count: 0, expires: now + WINDOW_MS }
    const previous = this.buckets.get(key)
    const bucket = previous && previous.expires > now ? previous : { count: 0, expires: now + WINDOW_MS }
    if (this.total.count >= 50 || bucket.count >= (unknown ? 1 : 5)) return null
    bucket.count++
    this.total.count++
    this.buckets.set(key, bucket)
    event.event_id ??= randomUUID().replaceAll('-', '')
    logger.info('Error report accepted for delivery', {
      reportId: event.event_id,
      module: tags.module,
      operation: tags.operation,
      failureKind: facts?.kind
    })
    return event
  }
}
