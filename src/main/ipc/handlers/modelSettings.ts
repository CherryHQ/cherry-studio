import { modelSettingsBackupService } from '@main/services/ModelSettingsBackupService'
import type { modelSettingsRequestSchemas } from '@shared/ipc/schemas/modelSettings'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const modelSettingsHandlers: IpcHandlersFor<typeof modelSettingsRequestSchemas> = {
  'model_settings.export': (_, ctx) => modelSettingsBackupService.exportToFile(ctx.senderId),
  'model_settings.import_preview': (_, ctx) => modelSettingsBackupService.pickImportFile(ctx.senderId),
  'model_settings.import_apply': async ({ document, decisions }) =>
    modelSettingsBackupService.applyImport(document, decisions)
}
