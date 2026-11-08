import { getRuntimeProvenance } from '@main/services/codeCli/runtimeProvenance'
import type { runtimeProvenanceRequestSchemas } from '@shared/ipc/schemas/runtimeProvenance'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const runtimeProvenanceHandlers: IpcHandlersFor<typeof runtimeProvenanceRequestSchemas> = {
  'runtime_provenance.get': (tool) => getRuntimeProvenance(tool)
}
