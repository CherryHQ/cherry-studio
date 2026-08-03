import { ExportService } from '@main/services/ExportService'
import ObsidianVaultService from '@main/services/ObsidianVaultService'
import type { exportRequestSchemas } from '@shared/ipc/schemas/export'
import type { IpcHandlersFor } from '@shared/ipc/types'

// Both are plain, non-lifecycle classes; a single module-level instance backs the routes.
const exportService = new ExportService()
const obsidianVaultService = new ObsidianVaultService()

export const exportHandlers: IpcHandlersFor<typeof exportRequestSchemas> = {
  'export.word.from_markdown': async ({ markdown, fileName }) => {
    await exportService.exportToWord(markdown, fileName)
  },
  'export.obsidian.get_vaults': async () => obsidianVaultService.getVaults(),
  'export.obsidian.get_files': async ({ vaultName }) => obsidianVaultService.getFilesByVaultName(vaultName)
}
