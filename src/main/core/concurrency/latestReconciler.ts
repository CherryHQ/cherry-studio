import { loggerService } from '@logger'
import {
  createLatestReconciler as createReconciler,
  type LatestReconciler,
  type LatestReconcilerOptions as ReconcilerOptions
} from '@shared/utils/async'

export type { LatestReconciler } from '@shared/utils/async'

export interface LatestReconcilerOptions<T> extends Omit<ReconcilerOptions<T>, 'onError'> {
  name: string
  onError?: ReconcilerOptions<T>['onError']
}

/** Adds main-process logging to the shared convergence primitive. */
export function createLatestReconciler<T>(options: LatestReconcilerOptions<T>): LatestReconciler {
  return createReconciler({
    ...options,
    onError:
      options.onError ??
      ((error) => {
        loggerService.withContext('latestReconciler').error(`[${options.name}] reconcile failed`, error as Error)
      })
  })
}
