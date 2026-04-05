import { IpcChannel } from '@shared/IpcChannel'
import type { FileListResponse, FileMetadata, FileUploadResponse, Provider } from '@types'
import { ipcRenderer } from 'electron'

// TODO: This module is a catch-all for miscellaneous file-related APIs (fs, pdf, export,
// fileService, openPath) that don't fit neatly into file.ts. Their IpcChannel scope should be
// re-evaluated — mirrors the same issue as src/main/ipc/fileUtils.ts.
export const fileUtilsApi = {
  fs: {
    read: (pathOrUrl: string, encoding?: BufferEncoding) => ipcRenderer.invoke(IpcChannel.Fs_Read, pathOrUrl, encoding),
    readText: (pathOrUrl: string): Promise<string> => ipcRenderer.invoke(IpcChannel.Fs_ReadText, pathOrUrl)
  },
  pdf: {
    extractText: (data: Uint8Array | ArrayBuffer | string): Promise<string> =>
      ipcRenderer.invoke(IpcChannel.Pdf_ExtractText, data)
  },
  export: {
    toWord: (markdown: string, fileName: string) => ipcRenderer.invoke(IpcChannel.Export_Word, markdown, fileName)
  },
  fileService: {
    upload: (provider: Provider, file: FileMetadata): Promise<FileUploadResponse> =>
      ipcRenderer.invoke(IpcChannel.FileService_Upload, provider, file),
    list: (provider: Provider): Promise<FileListResponse> => ipcRenderer.invoke(IpcChannel.FileService_List, provider),
    delete: (provider: Provider, fileId: string) => ipcRenderer.invoke(IpcChannel.FileService_Delete, provider, fileId),
    retrieve: (provider: Provider, fileId: string): Promise<FileUploadResponse> =>
      ipcRenderer.invoke(IpcChannel.FileService_Retrieve, provider, fileId)
  },
  openPath: (path: string) => ipcRenderer.invoke(IpcChannel.Open_Path, path)
}
