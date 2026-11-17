import * as Sentry from '@sentry/electron/main'

import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { attachSentryLogTransport } from './sentry'

@Injectable('SentryLogService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['PreferenceService'])
export class SentryLogService extends BaseService {
  protected onInit(): void {
    if (import.meta.env.DEV) return
    // Startup dumps must wait for PreferenceService; scanning earlier would delete
    // them after the preboot consent gate drops their events.
    Sentry.addIntegration(Sentry.sentryMinidumpIntegration())
    this.registerDisposable(attachSentryLogTransport())
  }
}
