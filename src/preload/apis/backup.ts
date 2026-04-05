import type {
  LanClientEvent,
  LanFileCompleteMessage,
  LanHandshakeAckMessage,
  LanTransferConnectPayload,
  LanTransferState
} from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { S3Config, WebDavConfig } from '@types'
import { ipcRenderer } from 'electron'
import type { CreateDirectoryOptions } from 'webdav'

export const backupApi = {
  backup: {
    restore: (path: string) => ipcRenderer.invoke(IpcChannel.Backup_Restore, path),
    // Direct backup methods (copy IndexedDB/LocalStorage directories directly)
    backup: (fileName: string, destinationPath: string, skipBackupFile: boolean) =>
      ipcRenderer.invoke(IpcChannel.Backup_Backup, fileName, destinationPath, skipBackupFile),
    backupToWebdav: (webdavConfig: WebDavConfig) => ipcRenderer.invoke(IpcChannel.Backup_BackupToWebdav, webdavConfig),
    restoreFromWebdav: (webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_RestoreFromWebdav, webdavConfig),
    listWebdavFiles: (webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_ListWebdavFiles, webdavConfig),
    checkConnection: (webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_CheckConnection, webdavConfig),
    createDirectory: (webdavConfig: WebDavConfig, path: string, options?: CreateDirectoryOptions) =>
      ipcRenderer.invoke(IpcChannel.Backup_CreateDirectory, webdavConfig, path, options),
    deleteWebdavFile: (fileName: string, webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_DeleteWebdavFile, fileName, webdavConfig),
    backupToLocalDir: (fileName: string, localConfig: { localBackupDir?: string; skipBackupFile?: boolean }) =>
      ipcRenderer.invoke(IpcChannel.Backup_BackupToLocalDir, fileName, localConfig),
    restoreFromLocalBackup: (fileName: string, localBackupDir?: string) =>
      ipcRenderer.invoke(IpcChannel.Backup_RestoreFromLocalBackup, fileName, localBackupDir),
    listLocalBackupFiles: (localBackupDir?: string) =>
      ipcRenderer.invoke(IpcChannel.Backup_ListLocalBackupFiles, localBackupDir),
    deleteLocalBackupFile: (fileName: string, localBackupDir?: string) =>
      ipcRenderer.invoke(IpcChannel.Backup_DeleteLocalBackupFile, fileName, localBackupDir),
    checkWebdavConnection: (webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_CheckConnection, webdavConfig),
    backupToS3: (s3Config: S3Config) => ipcRenderer.invoke(IpcChannel.Backup_BackupToS3, s3Config),
    restoreFromS3: (s3Config: S3Config) => ipcRenderer.invoke(IpcChannel.Backup_RestoreFromS3, s3Config),
    listS3Files: (s3Config: S3Config) => ipcRenderer.invoke(IpcChannel.Backup_ListS3Files, s3Config),
    deleteS3File: (fileName: string, s3Config: S3Config) =>
      ipcRenderer.invoke(IpcChannel.Backup_DeleteS3File, fileName, s3Config),
    checkS3Connection: (s3Config: S3Config) => ipcRenderer.invoke(IpcChannel.Backup_CheckS3Connection, s3Config),
    createLanTransferBackup: (data: string, destinationPath?: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannel.Backup_CreateLanTransferBackup, data, destinationPath),
    deleteLanTransferBackup: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.Backup_DeleteLanTransferBackup, filePath)
  },
  lanTransfer: {
    getState: (): Promise<LanTransferState> => ipcRenderer.invoke(IpcChannel.LanTransfer_ListServices),
    startScan: (): Promise<LanTransferState> => ipcRenderer.invoke(IpcChannel.LanTransfer_StartScan),
    stopScan: (): Promise<LanTransferState> => ipcRenderer.invoke(IpcChannel.LanTransfer_StopScan),
    connect: (payload: LanTransferConnectPayload): Promise<LanHandshakeAckMessage> =>
      ipcRenderer.invoke(IpcChannel.LanTransfer_Connect, payload),
    disconnect: (): Promise<void> => ipcRenderer.invoke(IpcChannel.LanTransfer_Disconnect),
    onServicesUpdated: (callback: (state: LanTransferState) => void): (() => void) => {
      const channel = IpcChannel.LanTransfer_ServicesUpdated
      const listener = (_: Electron.IpcRendererEvent, state: LanTransferState) => callback(state)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    onClientEvent: (callback: (event: LanClientEvent) => void): (() => void) => {
      const channel = IpcChannel.LanTransfer_ClientEvent
      const listener = (_: Electron.IpcRendererEvent, event: LanClientEvent) => callback(event)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    sendFile: (filePath: string): Promise<LanFileCompleteMessage> =>
      ipcRenderer.invoke(IpcChannel.LanTransfer_SendFile, { filePath }),
    cancelTransfer: (): Promise<void> => ipcRenderer.invoke(IpcChannel.LanTransfer_CancelTransfer)
  }
}
