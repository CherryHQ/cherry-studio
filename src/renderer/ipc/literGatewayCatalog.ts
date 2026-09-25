import type {
  LiterAliasMutation,
  LiterConnectionMutation,
  LiterGatewayCatalogSnapshot,
  LiterGatewaySelection
} from '@shared/types/literGateway'

import { ipcApi } from './ipcApi'

export const literGatewayCatalogApi = {
  read: (): Promise<LiterGatewayCatalogSnapshot> => ipcApi.request('prometheus.liter.catalog.read', {}),
  refresh: (): Promise<LiterGatewayCatalogSnapshot> => ipcApi.request('prometheus.liter.catalog.refresh', {}),
  selectGateway: (selection: LiterGatewaySelection): Promise<LiterGatewayCatalogSnapshot> =>
    ipcApi.request('prometheus.liter.gateway.select', selection),
  saveConnection: (mutation: LiterConnectionMutation): Promise<LiterGatewayCatalogSnapshot> =>
    ipcApi.request('prometheus.liter.connections.save', mutation),
  deleteConnection: (
    providerConnectionId: string,
    expectedRevision: number
  ): Promise<LiterGatewayCatalogSnapshot> =>
    ipcApi.request('prometheus.liter.connections.delete', { providerConnectionId, expectedRevision }),
  saveAlias: (mutation: LiterAliasMutation): Promise<LiterGatewayCatalogSnapshot> =>
    ipcApi.request('prometheus.liter.aliases.save', mutation),
  deleteAlias: (
    gatewayConnectionId: string,
    alias: string,
    expectedRevision: number
  ): Promise<LiterGatewayCatalogSnapshot> =>
    ipcApi.request('prometheus.liter.aliases.delete', { gatewayConnectionId, alias, expectedRevision })
}
