import type { SpanContext } from '@opentelemetry/api'
import type { FileChangeEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { FileMetadata } from '@types'
import type { OpenDialogOptions } from 'electron'
import { ipcRenderer, webUtils } from 'electron'

export type DirectoryListOptions = {
  recursive?: boolean
  maxDepth?: number
  includeHidden?: boolean
  includeFiles?: boolean
  includeDirectories?: boolean
  maxEntries?: number
  searchPattern?: string
}

export const fileApi = {
  file: {
    select: (options?: OpenDialogOptions): Promise<FileMetadata[] | null> =>
      ipcRenderer.invoke(IpcChannel.File_Select, options),
    upload: (file: FileMetadata) => ipcRenderer.invoke(IpcChannel.File_Upload, file),
    delete: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_Delete, fileId),
    deleteDir: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_DeleteDir, dirPath),
    deleteExternalFile: (filePath: string) => ipcRenderer.invoke(IpcChannel.File_DeleteExternalFile, filePath),
    deleteExternalDir: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_DeleteExternalDir, dirPath),
    move: (path: string, newPath: string) => ipcRenderer.invoke(IpcChannel.File_Move, path, newPath),
    moveDir: (dirPath: string, newDirPath: string) => ipcRenderer.invoke(IpcChannel.File_MoveDir, dirPath, newDirPath),
    rename: (path: string, newName: string) => ipcRenderer.invoke(IpcChannel.File_Rename, path, newName),
    renameDir: (dirPath: string, newName: string) => ipcRenderer.invoke(IpcChannel.File_RenameDir, dirPath, newName),
    read: (fileId: string, detectEncoding?: boolean) =>
      ipcRenderer.invoke(IpcChannel.File_Read, fileId, detectEncoding),
    readExternal: (filePath: string, detectEncoding?: boolean) =>
      ipcRenderer.invoke(IpcChannel.File_ReadExternal, filePath, detectEncoding),
    clear: (spanContext?: SpanContext) => ipcRenderer.invoke(IpcChannel.File_Clear, spanContext),
    get: (filePath: string): Promise<FileMetadata | null> => ipcRenderer.invoke(IpcChannel.File_Get, filePath),
    createTempFile: (fileName: string): Promise<string> => ipcRenderer.invoke(IpcChannel.File_CreateTempFile, fileName),
    mkdir: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_Mkdir, dirPath),
    write: (filePath: string, data: Uint8Array | string) => ipcRenderer.invoke(IpcChannel.File_Write, filePath, data),
    writeWithId: (id: string, content: string) => ipcRenderer.invoke(IpcChannel.File_WriteWithId, id, content),
    open: (options?: OpenDialogOptions) => ipcRenderer.invoke(IpcChannel.File_Open, options),
    openPath: (path: string) => ipcRenderer.invoke(IpcChannel.File_OpenPath, path),
    save: (path: string, content: string | NodeJS.ArrayBufferView, options?: any) =>
      ipcRenderer.invoke(IpcChannel.File_Save, path, content, options),
    selectFolder: (options?: OpenDialogOptions): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.File_SelectFolder, options),
    saveImage: (name: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.File_SaveImage, name, data),
    binaryImage: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_BinaryImage, fileId),
    base64Image: (fileId: string): Promise<{ mime: string; base64: string; data: string }> =>
      ipcRenderer.invoke(IpcChannel.File_Base64Image, fileId),
    saveBase64Image: (data: string) => ipcRenderer.invoke(IpcChannel.File_SaveBase64Image, data),
    savePastedImage: (imageData: Uint8Array, extension?: string) =>
      ipcRenderer.invoke(IpcChannel.File_SavePastedImage, imageData, extension),
    download: (url: string, isUseContentType?: boolean) =>
      ipcRenderer.invoke(IpcChannel.File_Download, url, isUseContentType),
    copy: (fileId: string, destPath: string) => ipcRenderer.invoke(IpcChannel.File_Copy, fileId, destPath),
    base64File: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_Base64File, fileId),
    pdfInfo: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_GetPdfInfo, fileId),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    openFileWithRelativePath: (file: FileMetadata) => ipcRenderer.invoke(IpcChannel.File_OpenWithRelativePath, file),
    isTextFile: (filePath: string): Promise<boolean> => ipcRenderer.invoke(IpcChannel.File_IsTextFile, filePath),
    isDirectory: (filePath: string): Promise<boolean> => ipcRenderer.invoke(IpcChannel.File_IsDirectory, filePath),
    getDirectoryStructure: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_GetDirectoryStructure, dirPath),
    listDirectory: (dirPath: string, options?: DirectoryListOptions) =>
      ipcRenderer.invoke(IpcChannel.File_ListDirectory, dirPath, options),
    checkFileName: (dirPath: string, fileName: string, isFile: boolean) =>
      ipcRenderer.invoke(IpcChannel.File_CheckFileName, dirPath, fileName, isFile),
    validateNotesDirectory: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_ValidateNotesDirectory, dirPath),
    startFileWatcher: (dirPath: string, config?: any) =>
      ipcRenderer.invoke(IpcChannel.File_StartWatcher, dirPath, config),
    stopFileWatcher: () => ipcRenderer.invoke(IpcChannel.File_StopWatcher),
    pauseFileWatcher: () => ipcRenderer.invoke(IpcChannel.File_PauseWatcher),
    resumeFileWatcher: () => ipcRenderer.invoke(IpcChannel.File_ResumeWatcher),
    batchUploadMarkdown: (filePaths: string[], targetPath: string) =>
      ipcRenderer.invoke(IpcChannel.File_BatchUploadMarkdown, filePaths, targetPath),
    onFileChange: (callback: (data: FileChangeEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: any) => {
        if (data && typeof data === 'object') {
          callback(data)
        }
      }
      ipcRenderer.on('file-change', listener)
      return () => ipcRenderer.off('file-change', listener)
    },
    showInFolder: (path: string): Promise<void> => ipcRenderer.invoke(IpcChannel.File_ShowInFolder, path)
  }
}
