import type { IntegrationFeature } from '@shared/types/prometheusIntegration'

export class StaleIntegrationRevisionError extends Error {
  constructor(
    readonly feature: IntegrationFeature,
    readonly expected: number,
    readonly current: number
  ) {
    super('prometheus.error.staleIntegrationRevision')
    this.name = 'StaleIntegrationRevisionError'
  }
}
