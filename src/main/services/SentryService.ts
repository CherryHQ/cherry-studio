import { application } from '@application'
import {
  BaseService,
  DependsOn,
  Injectable,
  type LifecycleEventPayload,
  LifecycleEvents,
  LifecycleState,
  Phase,
  ServicePhase
} from '@main/core/lifecycle'

import { reportStartupFailure, reportUnexpectedFailure } from './sentry'

@Injectable('SentryService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['DataApiService'])
export class SentryService extends BaseService {
  protected onInit(): void {
    if (import.meta.env.DEV) return
    const lifecycle = application.getLifecycleManager()
    const onServiceError = ({ name, state, error }: LifecycleEventPayload) => {
      if (
        error &&
        state === LifecycleState.Stopped &&
        (name === 'MainWindowService' || application.getContainer().getMetadata(name)?.errorStrategy === 'fail-fast')
      ) {
        void reportStartupFailure(error, name)
      }
    }
    lifecycle.on(LifecycleEvents.SERVICE_ERROR, onServiceError)
    this.registerDisposable(() => lifecycle.off(LifecycleEvents.SERVICE_ERROR, onServiceError))
    this.registerDisposable(application.get('DataApiService').getApiServer().onUnexpectedError(reportUnexpectedFailure))
  }
}
