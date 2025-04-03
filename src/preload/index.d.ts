import { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { ElectronAPI } from '@electron-toolkit/preload'
import type { FileMetadataResponse, ListFilesResponse, UploadFileResponse } from '@google/generative-ai/server'
import type { MCPServer, MCPTool } from '@renderer/types'
import { AppInfo, FileType, KnowledgeBaseParams, KnowledgeItem, LanguageVarious, WebDavConfig } from '@renderer/types'
import type { LoaderReturn } from '@shared/config/types'
import type { OpenDialogOptions } from 'electron'
import type { UpdateInfo } from 'electron-updater'

interface BackupFile {
  fileName: string
  modifiedTime: string
  size: number
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getAppInfo: () => Promise<AppInfo>
      checkForUpdate: () => Promise<{ currentVersion: string; updateInfo: UpdateInfo | null }>
      showUpdateDialog: () => Promise<void>
      openWebsite: (url: string) => void
      setProxy: (proxy: string | undefined) => void
      setLanguage: (theme: LanguageVarious) => void
      setLaunchOnBoot: (isActive: boolean) => void
      setLaunchToTray: (isActive: boolean) => void
      setTray: (isActive: boolean) => void
      setTrayOnClose: (isActive: boolean) => void
      restartTray: () => void
      setTheme: (theme: 'light' | 'dark') => void
      minApp: (options: { url: string; windowOptions?: Electron.BrowserWindowConstructorOptions }) => void
      reload: () => void
      clearCache: () => Promise<{ success: boolean; error?: string }>
      system: {
        getDeviceType: () => Promise<'mac' | 'windows' | 'linux'>
      }
      zip: {
        compress: (text: string) => Promise<Buffer>
        decompress: (text: Buffer) => Promise<string>
      }
      backup: {
        backup: (fileName: string, data: string, destinationPath?: string) => Promise<Readable>
        restore: (backupPath: string) => Promise<string>
        backupToWebdav: (data: string, webdavConfig: WebDavConfig) => Promise<boolean>
        restoreFromWebdav: (webdavConfig: WebDavConfig) => Promise<string>
        listWebdavFiles: (webdavConfig: WebDavConfig) => Promise<BackupFile[]>
        checkConnection: (webdavConfig: WebDavConfig) => Promise<boolean>
        createDirectory: (webdavConfig: WebDavConfig, path: string, options?: CreateDirectoryOptions) => Promise<void>
      }
      file: {
        select: (options?: OpenDialogOptions) => Promise<FileType[] | null>
        upload: (file: FileType) => Promise<FileType>
        delete: (fileId: string) => Promise<void>
        read: (fileId: string) => Promise<string>
        clear: () => Promise<void>
        get: (filePath: string) => Promise<FileType | null>
        selectFolder: () => Promise<string | null>
        create: (fileName: string) => Promise<string>
        write: (filePath: string, data: Uint8Array | string) => Promise<void>
        open: (options?: OpenDialogOptions) => Promise<{ fileName: string; filePath: string; content: Buffer } | null>
        openPath: (path: string) => Promise<void>
        save: (
          path: string,
          content: string | NodeJS.ArrayBufferView,
          options?: SaveDialogOptions
        ) => Promise<string | null>
        saveImage: (name: string, data: string) => void
        base64Image: (fileId: string) => Promise<{ mime: string; base64: string; data: string }>
        download: (url: string) => Promise<FileType | null>
        copy: (fileId: string, destPath: string) => Promise<void>
        binaryFile: (fileId: string) => Promise<{ data: Buffer; mime: string }>
      }
      fs: {
        read: (path: string) => Promise<string>
      }
      export: {
        toWord: (markdown: string, fileName: string) => Promise<void>
      }
      openPath: (path: string) => Promise<void>
      shortcuts: {
        update: (shortcuts: Shortcut[]) => Promise<void>
      }
      knowledgeBase: {
        create: (base: KnowledgeBaseParams) => Promise<void>
        reset: (base: KnowledgeBaseParams) => Promise<void>
        delete: (id: string) => Promise<void>
        add: ({
          base,
          item,
          forceReload = false
        }: {
          base: KnowledgeBaseParams
          item: KnowledgeItem
          forceReload?: boolean
        }) => Promise<LoaderReturn>
        remove: ({
          uniqueId,
          uniqueIds,
          base
        }: {
          uniqueId: string
          uniqueIds: string[]
          base: KnowledgeBaseParams
        }) => Promise<void>
        search: ({ search, base }: { search: string; base: KnowledgeBaseParams }) => Promise<ExtractChunkData[]>
        rerank: ({
          search,
          base,
          results
        }: {
          search: string
          base: KnowledgeBaseParams
          results: ExtractChunkData[]
        }) => Promise<ExtractChunkData[]>
      }
      window: {
        setMinimumSize: (width: number, height: number) => Promise<void>
        resetMinimumSize: () => Promise<void>
      }
      gemini: {
        uploadFile: (file: FileType, apiKey: string) => Promise<UploadFileResponse>
        retrieveFile: (file: FileType, apiKey: string) => Promise<FileMetadataResponse | undefined>
        base64File: (file: FileType) => Promise<{ data: string; mimeType: string }>
        listFiles: (apiKey: string) => Promise<ListFilesResponse>
        deleteFile: (apiKey: string, fileId: string) => Promise<void>
      }
      selectionMenu: {
        action: (action: string) => Promise<void>
      }
      config: {
        set: (key: string, value: any) => Promise<void>
        get: (key: string) => Promise<any>
      }
      miniWindow: {
        show: () => Promise<void>
        hide: () => Promise<void>
        close: () => Promise<void>
        toggle: () => Promise<void>
        setPin: (isPinned: boolean) => Promise<void>
      }
      aes: {
        encrypt: (text: string, secretKey: string, iv: string) => Promise<{ iv: string; encryptedData: string }>
        decrypt: (encryptedData: string, iv: string, secretKey: string) => Promise<string>
      }
      shell: {
        openExternal: (url: string, options?: OpenExternalOptions) => Promise<void>
      }
      mcp: {
        removeServer: (server: MCPServer) => Promise<void>
        restartServer: (server: MCPServer) => Promise<void>
        stopServer: (server: MCPServer) => Promise<void>
        listTools: (server: MCPServer) => Promise<MCPTool[]>
        callTool: ({ server, name, args }: { server: MCPServer; name: string; args: any }) => Promise<any>
        getInstallInfo: () => Promise<{ dir: string; uvPath: string; bunPath: string }>
      }
      copilot: {
        getAuthMessage: (
          headers?: Record<string, string>
        ) => Promise<{ device_code: string; user_code: string; verification_uri: string }>
        getCopilotToken: (device_code: string, headers?: Record<string, string>) => Promise<{ access_token: string }>
        saveCopilotToken: (access_token: string) => Promise<void>
        getToken: (headers?: Record<string, string>) => Promise<{ token: string }>
        logout: () => Promise<void>
        getUser: (token: string) => Promise<{ login: string; avatar: string }>
      }
      isBinaryExist: (name: string) => Promise<boolean>
      getBinaryPath: (name: string) => Promise<string>
      installUVBinary: () => Promise<void>
      installBunBinary: () => Promise<void>
      protocol: {
        onReceiveData: (callback: (data: { url: string; params: any }) => void) => () => void
      }
      nutstore: {
        getSSOUrl: () => Promise<string>
        decryptToken: (token: string) => Promise<{ username: string; access_token: string }>
        getDirectoryContents: (token: string, path: string) => Promise<any>
      }
    }
  }
}
