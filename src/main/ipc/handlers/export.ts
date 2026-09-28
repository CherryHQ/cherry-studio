import { DocumentConversionError, saveDocument } from '@main/services/documentConversion'
import { exportService } from '@main/services/ExportService'
import ObsidianVaultService from '@main/services/ObsidianVaultService'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { exportRequestSchemas } from '@shared/ipc/schemas/export'
import type { IpcHandlersFor } from '@shared/ipc/types'

// Both are plain, non-lifecycle classes; a single module-level instance backs the routes.
const obsidianVaultService = new ObsidianVaultService()

export const exportHandlers: IpcHandlersFor<typeof exportRequestSchemas> = {
  'export.document.convert_and_save': async (input) => {
    try {
      return await saveDocument(input)
    } catch (error) {
      if (error instanceof DocumentConversionError) {
        throw new IpcError(error.code, error.message, { code: error.code, preview: error.preview })
      }
      throw error
    }
  },
  'export.word.from_markdown': async ({ markdown, fileName }) => {
    await exportService.exportToWord(markdown, fileName)
  },
  'export.obsidian.get_vaults': async () => obsidianVaultService.getVaults(),
  'export.obsidian.get_files': async ({ vaultName }) => obsidianVaultService.getFilesByVaultName(vaultName)
}
