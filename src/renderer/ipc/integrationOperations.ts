import type {
  IntegrationOperationEventPage,
  IntegrationOperationLogExport,
  IntegrationOperationLogPage
} from '@shared/types/prometheusIntegration'

import { ipcApi } from './ipcApi'

export const integrationOperations = {
  cancel: (id: string): Promise<void> => ipcApi.request('prometheus.integration.cancel', { id }),
  events: (id: string, after?: number, limit?: number): Promise<IntegrationOperationEventPage> =>
    ipcApi.request('prometheus.integration.operation_events', { id, after, limit }),
  readLog: (id: string, offset?: number, limit?: number): Promise<IntegrationOperationLogPage> =>
    ipcApi.request('prometheus.integration.operation_log', { id, offset, limit }),
  exportLog: (id: string): Promise<IntegrationOperationLogExport> =>
    ipcApi.request('prometheus.integration.export_log', { id })
}
