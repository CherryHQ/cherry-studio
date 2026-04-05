import { IpcChannel } from '@shared/IpcChannel'
import { extractPdfText } from '@shared/utils/pdf'
import type { FileMetadata, Provider } from '@types'
import { ipcMain, shell } from 'electron'

import { ExportService } from '../services/ExportService'
import FileService from '../services/FileSystemService'
import { fileServiceManager } from '../services/remotefile/FileServiceManager'

const exportService = new ExportService()

// TODO: This module is a catch-all for miscellaneous file-related handlers (Pdf, Fs, FileService,
// Export, Open_Path) that don't fit neatly into file.ts. Their IpcChannel scope should be
// re-evaluated — e.g., Pdf/Export/Open could become their own scopes, or be folded into
// more appropriate modules.
export function registerFileUtilsIpc() {
  // pdf
  ipcMain.handle(IpcChannel.Pdf_ExtractText, (_, data: Uint8Array | ArrayBuffer | string) => extractPdfText(data))

  // file service
  ipcMain.handle(IpcChannel.FileService_Upload, async (_, provider: Provider, file: FileMetadata) => {
    const service = fileServiceManager.getService(provider)
    return await service.uploadFile(file)
  })

  ipcMain.handle(IpcChannel.FileService_List, async (_, provider: Provider) => {
    const service = fileServiceManager.getService(provider)
    return await service.listFiles()
  })

  ipcMain.handle(IpcChannel.FileService_Delete, async (_, provider: Provider, fileId: string) => {
    const service = fileServiceManager.getService(provider)
    return await service.deleteFile(fileId)
  })

  ipcMain.handle(IpcChannel.FileService_Retrieve, async (_, provider: Provider, fileId: string) => {
    const service = fileServiceManager.getService(provider)
    return await service.retrieveFile(fileId)
  })

  // fs
  ipcMain.handle(IpcChannel.Fs_Read, FileService.readFile.bind(FileService))
  ipcMain.handle(IpcChannel.Fs_ReadText, FileService.readTextFileWithAutoEncoding.bind(FileService))

  // export
  ipcMain.handle(IpcChannel.Export_Word, exportService.exportToWord.bind(exportService))

  // open path
  ipcMain.handle(IpcChannel.Open_Path, async (_, path: string) => {
    await shell.openPath(path)
  })
}
