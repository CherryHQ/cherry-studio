import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { attachSentryLogTransport } from './sentry'

@Injectable('SentryLogService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['PreferenceService'])
export class SentryLogService extends BaseService {
  protected onInit(): void {
    if (import.meta.env.DEV) return
    this.registerDisposable(attachSentryLogTransport())
  }
}
