import { ElectronAPI } from '@electron-toolkit/preload'
import { FileType } from '@renderer/types'
import { WebDavConfig } from '@renderer/types'
import { LanguageVarious } from '@renderer/types'
import type { OpenDialogOptions } from 'electron'
import { Readable } from 'stream'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getAppInfo: () => Promise<{
        version: string
        isPackaged: boolean
        appPath: string
        filesPath: string
      }>
      checkForUpdate: () => void
      openWebsite: (url: string) => void
      setProxy: (proxy: string | undefined) => void
      setLanguage: (theme: LanguageVarious) => void
      setTheme: (theme: 'light' | 'dark') => void
      minApp: (options: { url: string; windowOptions?: Electron.BrowserWindowConstructorOptions }) => void
      reload: () => void
      zip: {
        compress: (text: string) => Promise<Buffer>
        decompress: (text: Buffer) => Promise<string>
      }
      backup: {
        backup: (fileName: string, data: string, destinationPath?: string) => Promise<Readable>
        restore: (backupPath: string) => Promise<string>
        backupToWebdav: (data: string, webdavConfig: WebDavConfig) => Promise<boolean>
        restoreFromWebdav: (webdavConfig: WebDavConfig) => Promise<string>
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
        save: (
          path: string,
          content: string | NodeJS.ArrayBufferView,
          options?: SaveDialogOptions
        ) => Promise<string | null>
        saveImage: (name: string, data: string) => void
        base64Image: (fileId: string) => Promise<{ mime: string; base64: string; data: string }>
        download: (url: string) => Promise<FileType | null>
        copy: (fileId: string, destPath: string) => Promise<void>
      }
      export: {
        toWord: (markdown: string, fileName: string) => Promise<void>
      }
    }
  }
}
