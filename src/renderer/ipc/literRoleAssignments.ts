import type {
  LiterRoleApplyResult,
  LiterRoleDocumentSnapshot,
  LiterRoleExportResult,
  LiterRoleMutation,
  LiterRoleSnapshot,
  LiterRoleSource,
  LiterRoleSourceSelection
} from '@shared/types/literRoles'

import { ipcApi } from './ipcApi'

export const literRoleAssignmentsApi = {
  read: (): Promise<LiterRoleSnapshot> => ipcApi.request('prometheus.liter.roles.read', {}),
  save: (mutation: LiterRoleMutation): Promise<LiterRoleSnapshot> =>
    ipcApi.request('prometheus.liter.roles.save', mutation),
  selectLocal: (): Promise<LiterRoleSourceSelection> => ipcApi.request('prometheus.liter.roles.select_local', {}),
  readDocument: (source: LiterRoleSource): Promise<LiterRoleDocumentSnapshot> =>
    ipcApi.request('prometheus.liter.roles.read_document', { source }),
  apply: (source: LiterRoleSource, expectedRevision: string): Promise<LiterRoleApplyResult> =>
    ipcApi.request('prometheus.liter.roles.apply', { source, expectedRevision }),
  export: (source: LiterRoleSource, expectedRevision: string): Promise<LiterRoleExportResult> =>
    ipcApi.request('prometheus.liter.roles.export', { source, expectedRevision })
}
