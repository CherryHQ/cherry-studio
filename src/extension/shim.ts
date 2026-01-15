/**
 * Chrome Extension Shim for window.api
 *
 * This shim provides Chrome extension equivalents for Electron's preload API.
 * It enables the existing renderer code to work in a Chrome extension context
 * with minimal changes.
 */

import type { WindowApiType } from '../preload'

// Message types for background communication
type MessageType =
  | 'storage:get'
  | 'storage:set'
  | 'mcp:listTools'
  | 'mcp:callTool'
  | 'mcp:connect'
  | 'mcp:disconnect'
  | 'backup:webdav'
  | 'backup:s3'
  | 'config:get'
  | 'config:set'

interface BackgroundMessage {
  type: MessageType
  payload?: unknown
}

// Helper to send messages to background service worker
async function sendToBackground<T>(type: MessageType, payload?: unknown): Promise<T> {
  return chrome.runtime.sendMessage({ type, payload })
}

// IndexedDB wrapper for file storage (reuses existing Dexie schema)
class ExtensionFileStorage {
  private dbName = 'CherryStudioExtension'
  private db: IDBDatabase | null = null

  private async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' })
        }
      }
    })
  }

  async save(id: string, blob: Blob, metadata: Record<string, unknown>): Promise<string> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      const store = tx.objectStore('files')
      store.put({ id, blob, metadata, createdAt: Date.now() })
      tx.oncomplete = () => resolve(id)
      tx.onerror = () => reject(tx.error)
    })
  }

  async get(id: string): Promise<{ blob: Blob; metadata: Record<string, unknown> } | null> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly')
      const store = tx.objectStore('files')
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async delete(id: string): Promise<void> {
    const db = await this.getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      const store = tx.objectStore('files')
      store.delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}

const fileStorage = new ExtensionFileStorage()

// No-op function for unsupported features
const noop = () => Promise.resolve()
const noopReturn = <T>(value: T) => () => Promise.resolve(value)

// Create the extension API shim
const extensionApi: WindowApiType = {
  // ===== App Info & Lifecycle =====
  getAppInfo: async () => ({
    version: chrome.runtime.getManifest().version,
    isPackaged: true,
    appPath: '',
    filesPath: '',
    appDataPath: '',
    logsPath: '',
    locale: navigator.language,
    isLinux: false,
    isMac: false,
    isWindows: false,
    arch: 'x64',
    platform: 'browser'
  }),
  getDiskInfo: noopReturn(null),
  reload: () => {
    window.location.reload()
    return Promise.resolve()
  },
  quit: noop,
  setProxy: noop,
  checkForUpdate: noopReturn({ updateAvailable: false }),
  quitAndInstall: noop,
  setLanguage: noop,
  setEnableSpellCheck: noop,
  setSpellCheckLanguages: noop,
  setLaunchOnBoot: noop,
  setLaunchToTray: noop,
  setTray: noop,
  setTrayOnClose: noop,
  setTestPlan: noop,
  setTestChannel: noop,
  setTheme: async (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    await chrome.storage.local.set({ theme })
  },
  handleZoomFactor: async (delta, reset) => {
    const current = document.body.style.zoom ? parseFloat(document.body.style.zoom) : 1
    document.body.style.zoom = reset ? '1' : `${current + delta * 0.1}`
  },
  setAutoUpdate: noop,
  select: async () => null, // Use file.select instead
  hasWritePermission: noopReturn(false),
  resolvePath: async (path) => path,
  isPathInside: noopReturn(false),
  setAppDataPath: noop,
  getDataPathFromArgs: noopReturn(null),
  copy: noop,
  setStopQuitApp: noop,
  flushAppData: noop,
  isNotEmptyDir: noopReturn(false),
  relaunchApp: noop,
  openWebsite: async (url) => {
    window.open(url, '_blank')
  },
  getCacheSize: noopReturn('0 MB'),
  clearCache: async () => {
    await caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name))))
  },
  logToMain: async (source, level, message, data) => {
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    logFn(`[${source.name}]`, message, ...data)
  },
  setFullScreen: noop,
  isFullScreen: noopReturn(false),
  getSystemFonts: noopReturn([]),
  mockCrashRenderProcess: noop,

  mac: {
    isProcessTrusted: noopReturn(true),
    requestProcessTrust: noopReturn(true)
  },

  notification: {
    send: async (notification) => {
      if (Notification.permission === 'granted') {
        new Notification(notification.title || 'Cherry Studio', {
          body: notification.body
        })
      } else if (Notification.permission !== 'denied') {
        await Notification.requestPermission()
      }
    }
  },

  system: {
    getDeviceType: noopReturn('desktop'),
    getHostname: async () => 'browser',
    getCpuName: noopReturn(''),
    checkGitBash: noopReturn(false),
    getGitBashPath: noopReturn(null),
    getGitBashPathInfo: noopReturn({ isInstalled: false, path: null }),
    setGitBashPath: noopReturn(false)
  },

  devTools: {
    toggle: noop
  },

  // ===== Compression (use browser APIs) =====
  zip: {
    compress: async (text) => {
      const encoder = new TextEncoder()
      const stream = new Blob([encoder.encode(text)]).stream()
      const compressedStream = stream.pipeThrough(new CompressionStream('gzip'))
      const blob = await new Response(compressedStream).blob()
      return new Uint8Array(await blob.arrayBuffer()) as unknown as Buffer
    },
    decompress: async (buffer) => {
      const stream = new Blob([buffer]).stream()
      const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'))
      return new Response(decompressedStream).text()
    }
  },

  // ===== Backup (cloud only in extension) =====
  backup: {
    backup: noop,
    restore: noopReturn(''),
    backupToWebdav: (data, config) => sendToBackground('backup:webdav', { action: 'backup', data, config }),
    restoreFromWebdav: (config) => sendToBackground('backup:webdav', { action: 'restore', config }),
    listWebdavFiles: (config) => sendToBackground('backup:webdav', { action: 'list', config }),
    checkConnection: (config) => sendToBackground('backup:webdav', { action: 'check', config }),
    createDirectory: noop,
    deleteWebdavFile: (fileName, config) => sendToBackground('backup:webdav', { action: 'delete', fileName, config }),
    backupToLocalDir: async (data, fileName) => {
      // Download as file
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      return fileName
    },
    restoreFromLocalBackup: noopReturn(''),
    listLocalBackupFiles: noopReturn([]),
    deleteLocalBackupFile: noop,
    checkWebdavConnection: (config) => sendToBackground('backup:webdav', { action: 'check', config }),
    backupToS3: (data, config) => sendToBackground('backup:s3', { action: 'backup', data, config }),
    restoreFromS3: (config) => sendToBackground('backup:s3', { action: 'restore', config }),
    listS3Files: (config) => sendToBackground('backup:s3', { action: 'list', config }),
    deleteS3File: (fileName, config) => sendToBackground('backup:s3', { action: 'delete', fileName, config }),
    checkS3Connection: (config) => sendToBackground('backup:s3', { action: 'check', config }),
    createLanTransferBackup: noopReturn(''),
    deleteTempBackup: noopReturn(true)
  },

  // ===== File Operations (use File API + IndexedDB) =====
  file: {
    select: async (options) => {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = options?.properties?.includes('multiSelections') ?? false
        if (options?.filters) {
          const extensions = options.filters.flatMap((f) => f.extensions || [])
          input.accept = extensions.map((e) => `.${e}`).join(',')
        }
        input.onchange = async () => {
          if (!input.files?.length) {
            resolve(null)
            return
          }
          const files = await Promise.all(
            Array.from(input.files).map(async (file) => {
              const id = crypto.randomUUID()
              const arrayBuffer = await file.arrayBuffer()
              await fileStorage.save(id, new Blob([arrayBuffer]), {
                name: file.name,
                size: file.size,
                type: file.type
              })
              return {
                id,
                name: file.name,
                path: file.name,
                size: file.size,
                ext: file.name.split('.').pop() || '',
                type: file.type,
                base64: null,
                created_at: new Date().toISOString(),
                count: 1
              }
            })
          )
          resolve(files)
        }
        input.click()
      })
    },
    upload: async (file) => file,
    delete: async (fileId) => {
      await fileStorage.delete(fileId)
    },
    deleteDir: noop,
    deleteExternalFile: noop,
    deleteExternalDir: noop,
    move: noop,
    moveDir: noop,
    rename: noop,
    renameDir: noop,
    read: async (fileId) => {
      const file = await fileStorage.get(fileId)
      if (!file) return null
      return file.blob.text()
    },
    readExternal: noopReturn(null),
    clear: noop,
    get: async (fileId) => {
      const file = await fileStorage.get(fileId)
      if (!file) return null
      return {
        id: fileId,
        name: (file.metadata.name as string) || '',
        path: (file.metadata.name as string) || '',
        size: file.metadata.size as number,
        ext: ((file.metadata.name as string) || '').split('.').pop() || '',
        type: file.metadata.type as string,
        base64: null,
        created_at: new Date().toISOString(),
        count: 1
      }
    },
    createTempFile: async () => crypto.randomUUID(),
    mkdir: noop,
    write: async (filePath, data) => {
      const id = crypto.randomUUID()
      const blob = typeof data === 'string' ? new Blob([data]) : new Blob([data])
      await fileStorage.save(id, blob, { name: filePath })
    },
    writeWithId: async (id, content) => {
      await fileStorage.save(id, new Blob([content]), { name: id })
    },
    open: noopReturn([]),
    openPath: async (path) => {
      window.open(path, '_blank')
    },
    save: async (path, content) => {
      const blob = typeof content === 'string' ? new Blob([content]) : new Blob([content])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = path.split('/').pop() || 'download'
      a.click()
      URL.revokeObjectURL(url)
    },
    selectFolder: noopReturn(null),
    saveImage: async (name, data) => {
      const blob = await fetch(data).then((r) => r.blob())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      return ''
    },
    binaryImage: async (fileId) => {
      const file = await fileStorage.get(fileId)
      return file ? new Uint8Array(await file.blob.arrayBuffer()) : new Uint8Array()
    },
    base64Image: async (fileId) => {
      const file = await fileStorage.get(fileId)
      if (!file) return { mime: '', base64: '', data: '' }
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.readAsDataURL(file.blob)
      })
      return {
        mime: file.blob.type,
        base64,
        data: `data:${file.blob.type};base64,${base64}`
      }
    },
    saveBase64Image: async (data) => {
      const id = crypto.randomUUID()
      const blob = await fetch(data).then((r) => r.blob())
      await fileStorage.save(id, blob, { type: blob.type })
      return id
    },
    savePastedImage: async (imageData, extension = 'png') => {
      const id = crypto.randomUUID()
      const blob = new Blob([imageData], { type: `image/${extension}` })
      await fileStorage.save(id, blob, { type: blob.type, ext: extension })
      return { id, path: id }
    },
    download: async (url) => {
      const response = await fetch(url)
      const blob = await response.blob()
      const id = crypto.randomUUID()
      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      await fileStorage.save(id, blob, { type: contentType, url })
      return id
    },
    copy: noop,
    base64File: async (fileId) => {
      const file = await fileStorage.get(fileId)
      if (!file) return ''
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.readAsDataURL(file.blob)
      })
    },
    pdfInfo: noopReturn({ pageCount: 0, title: '', author: '' }),
    getPathForFile: (file) => file.name,
    openFileWithRelativePath: noop,
    isTextFile: noopReturn(true),
    getDirectoryStructure: noopReturn({ files: [], directories: [] }),
    listDirectory: noopReturn({ entries: [], totalCount: 0 }),
    checkFileName: noopReturn({ isValid: true }),
    validateNotesDirectory: noopReturn({ isValid: true }),
    startFileWatcher: noop,
    stopFileWatcher: noop,
    pauseFileWatcher: noop,
    resumeFileWatcher: noop,
    batchUploadMarkdown: noopReturn([]),
    onFileChange: () => () => {},
    showInFolder: noop
  },

  fs: {
    read: async (pathOrUrl) => {
      const response = await fetch(pathOrUrl)
      return new Uint8Array(await response.arrayBuffer()) as unknown as Buffer
    },
    readText: async (pathOrUrl) => {
      const response = await fetch(pathOrUrl)
      return response.text()
    }
  },

  export: {
    toWord: async (markdown, fileName) => {
      // Simple markdown to HTML then download
      const html = `<!DOCTYPE html><html><body>${markdown}</body></html>`
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName.replace('.docx', '.html')
      a.click()
      URL.revokeObjectURL(url)
    }
  },

  obsidian: {
    getVaults: noopReturn([]),
    getFolders: noopReturn([]),
    getFiles: noopReturn([])
  },

  openPath: async (path) => {
    window.open(path, '_blank')
  },

  shortcuts: {
    update: noop
  },

  // ===== Knowledge Base (limited in extension) =====
  knowledgeBase: {
    create: noopReturn({ success: true }),
    reset: noop,
    delete: noop,
    add: noop,
    remove: noop,
    search: noopReturn([]),
    rerank: noopReturn([]),
    checkQuota: noopReturn({ withinQuota: true })
  },

  // ===== Memory (use chrome.storage) =====
  memory: {
    add: noop,
    search: noopReturn([]),
    list: noopReturn([]),
    delete: noop,
    update: noop,
    get: noopReturn(null),
    setConfig: noop,
    deleteUser: noop,
    deleteAllMemoriesForUser: noop,
    getUsersList: noopReturn([]),
    migrateMemoryDb: noop
  },

  window: {
    setMinimumSize: noop,
    resetMinimumSize: noop,
    getSize: async () => [window.innerWidth, window.innerHeight]
  },

  fileService: {
    upload: noopReturn({ id: '', status: 'error' }),
    list: noopReturn({ files: [] }),
    delete: noop,
    retrieve: noopReturn({ id: '', status: 'error' })
  },

  selectionMenu: {
    action: noop
  },

  vertexAI: {
    getAuthHeaders: noopReturn({}),
    getAccessToken: noopReturn(''),
    clearAuthCache: noop
  },

  ovms: {
    isSupported: noopReturn(false),
    addModel: noop,
    stopAddModel: noop,
    getModels: noopReturn([]),
    isRunning: noopReturn(false),
    getStatus: noopReturn({ running: false }),
    runOvms: noop,
    stopOvms: noop
  },

  // ===== Config (use chrome.storage) =====
  config: {
    set: async (key, value) => {
      await chrome.storage.local.set({ [`config:${key}`]: value })
    },
    get: async (key) => {
      const result = await chrome.storage.local.get(`config:${key}`)
      return result[`config:${key}`]
    }
  },

  miniWindow: {
    show: noop,
    hide: noop,
    close: noop,
    toggle: noop,
    setPin: noop
  },

  aes: {
    encrypt: async (text, secretKey, iv) => {
      const encoder = new TextEncoder()
      const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secretKey), 'AES-CBC', false, ['encrypt'])
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: encoder.encode(iv) }, keyMaterial, encoder.encode(text))
      return btoa(String.fromCharCode(...new Uint8Array(encrypted)))
    },
    decrypt: async (encryptedData, iv, secretKey) => {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secretKey), 'AES-CBC', false, ['decrypt'])
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: encoder.encode(iv) },
        keyMaterial,
        Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0))
      )
      return decoder.decode(decrypted)
    }
  },

  // ===== MCP (HTTP/SSE only in extension) =====
  mcp: {
    removeServer: (server) => sendToBackground('mcp:disconnect', { serverId: server.id }),
    restartServer: (server) => sendToBackground('mcp:connect', server),
    stopServer: (server) => sendToBackground('mcp:disconnect', { serverId: server.id }),
    listTools: (server) => sendToBackground('mcp:listTools', { serverId: server.id }),
    callTool: ({ server, name, args }) => sendToBackground('mcp:callTool', { serverId: server.id, name, args }),
    listPrompts: noopReturn([]),
    getPrompt: noopReturn({ messages: [] }),
    listResources: noopReturn([]),
    getResource: noopReturn({ contents: [] }),
    getInstallInfo: noopReturn({ installed: false }),
    checkMcpConnectivity: noopReturn({ connected: false }),
    uploadDxt: noopReturn({ success: false }),
    abortTool: noop,
    getServerVersion: noopReturn(null),
    getServerLogs: noopReturn([]),
    onServerLog: () => () => {}
  },

  python: {
    execute: noopReturn({ success: false, error: 'Not supported in extension' })
  },

  shell: {
    openExternal: async (url) => {
      window.open(url, '_blank')
    }
  },

  copilot: {
    getAuthMessage: noopReturn({}),
    getCopilotToken: noopReturn(''),
    saveCopilotToken: noop,
    getToken: noopReturn(''),
    logout: noop,
    getUser: noopReturn(null)
  },

  isBinaryExist: noopReturn(false),
  getBinaryPath: noopReturn(''),
  installUVBinary: noop,
  installBunBinary: noop,
  installOvmsBinary: noop,

  protocol: {
    onReceiveData: () => () => {}
  },

  nutstore: {
    getSSOUrl: noopReturn(''),
    decryptToken: noopReturn(''),
    getDirectoryContents: noopReturn([])
  },

  searchService: {
    openSearchWindow: noop,
    closeSearchWindow: noop,
    openUrlInSearchWindow: noop
  },

  webview: {
    setOpenLinkExternal: noop,
    setSpellCheckEnabled: noop,
    printToPDF: noop,
    saveAsHTML: noop,
    onFindShortcut: () => () => {}
  },

  storeSync: {
    subscribe: noop,
    unsubscribe: noop,
    onUpdate: noop
  },

  selection: {
    hideToolbar: noop,
    writeToClipboard: async (text) => {
      await navigator.clipboard.writeText(text)
    },
    determineToolbarSize: noop,
    setEnabled: noop,
    setTriggerMode: noop,
    setFollowToolbar: noop,
    setRemeberWinSize: noop,
    setFilterMode: noop,
    setFilterList: noop,
    processAction: noop,
    closeActionWindow: noop,
    minimizeActionWindow: noop,
    pinActionWindow: noop,
    resizeActionWindow: noop
  },

  agentTools: {
    respondToPermission: noop
  },

  quoteToMainWindow: noop,
  setDisableHardwareAcceleration: noop,

  trace: {
    saveData: noop,
    getData: noopReturn(null),
    saveEntity: noop,
    getEntity: noopReturn(null),
    bindTopic: noop,
    tokenUsage: noop,
    cleanHistory: noop,
    cleanTopic: noop,
    openWindow: noop,
    setTraceWindowTitle: noop,
    addEndMessage: noop,
    cleanLocalData: noop,
    addStreamMessage: noop
  },

  anthropic_oauth: {
    startOAuthFlow: async () => {
      // Use chrome.identity for OAuth
      return { authUrl: '' }
    },
    completeOAuthWithCode: noopReturn({ success: false }),
    cancelOAuthFlow: noop,
    getAccessToken: noopReturn(''),
    hasCredentials: noopReturn(false),
    clearCredentials: noop
  },

  codeTools: {
    run: noop,
    getAvailableTerminals: noopReturn([]),
    setCustomTerminalPath: noop,
    getCustomTerminalPath: noopReturn(undefined),
    removeCustomTerminalPath: noop
  },

  ocr: {
    ocr: noopReturn({ text: '', error: 'Not supported' }),
    listProviders: noopReturn([])
  },

  cherryai: {
    generateSignature: noopReturn({ signature: '' })
  },

  windowControls: {
    minimize: noop,
    maximize: noop,
    unmaximize: noop,
    close: async () => window.close(),
    isMaximized: noopReturn(false),
    onMaximizedChange: () => () => {}
  },

  apiServer: {
    getStatus: noopReturn({ running: false, port: 0 }),
    start: noopReturn({ success: false }),
    restart: noopReturn({ success: false }),
    stop: noopReturn({ success: true }),
    onReady: () => () => {}
  },

  claudeCodePlugin: {
    listAvailable: noopReturn({ success: false, data: { plugins: [] } }),
    install: noopReturn({ success: false }),
    uninstall: noopReturn({ success: false }),
    listInstalled: noopReturn({ success: true, data: [] }),
    invalidateCache: noopReturn({ success: true }),
    readContent: noopReturn({ success: false }),
    writeContent: noopReturn({ success: false })
  },

  localTransfer: {
    getState: noopReturn({ services: [], scanning: false }),
    startScan: noopReturn({ services: [], scanning: true }),
    stopScan: noopReturn({ services: [], scanning: false }),
    connect: noopReturn({ success: false }),
    disconnect: noop,
    onServicesUpdated: () => () => {},
    onClientEvent: () => () => {},
    sendFile: noopReturn({ success: false }),
    cancelTransfer: noop
  }
}

// Inject the shim as window.api
;(window as any).api = extensionApi

// Also provide electron stub
;(window as any).electron = {
  process: {
    platform: 'browser',
    versions: { chrome: navigator.userAgent }
  }
}

export { extensionApi }
export type { WindowApiType }
