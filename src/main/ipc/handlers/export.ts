import type { ExportService } from '@main/services/ExportService'
import type ObsidianVaultService from '@main/services/ObsidianVaultService'
import type { exportRequestSchemas } from '@shared/ipc/schemas/export'
import type { IpcHandlersFor } from '@shared/ipc/types'

let exportServicePromise: Promise<ExportService> | undefined
let obsidianVaultServicePromise: Promise<ObsidianVaultService> | undefined

const getExportService = async () => {
  exportServicePromise ??= import('@main/services/ExportService').then(({ ExportService }) => new ExportService())
  return exportServicePromise
}

const getObsidianVaultService = async () => {
  obsidianVaultServicePromise ??= import('@main/services/ObsidianVaultService').then(
    ({ default: ObsidianVaultService }) => new ObsidianVaultService()
  )
  return obsidianVaultServicePromise
}

export const exportHandlers: IpcHandlersFor<typeof exportRequestSchemas> = {
  'export.word.from_markdown': async ({ markdown, fileName }) => {
    const exportService = await getExportService()
    await exportService.exportToWord(markdown, fileName)
  },
  'export.obsidian.get_vaults': async () => (await getObsidianVaultService()).getVaults(),
  'export.obsidian.get_files': async ({ vaultName }) => (await getObsidianVaultService()).getFilesByVaultName(vaultName)
}
