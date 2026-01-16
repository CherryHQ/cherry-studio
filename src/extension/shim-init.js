/**
 * Shim Initialization Script
 *
 * This script MUST load BEFORE any ES modules to ensure window.api exists.
 * It provides minimal stubs that prevent "undefined" errors during module initialization.
 * The full shim (shim.ts) will replace these stubs with real implementations.
 */

;(function () {
  'use strict'

  if (!window.api) {
    window.api = {
      file: {
        read: () => Promise.resolve(''),
        write: () => Promise.resolve(),
        exists: () => Promise.resolve(false),
        delete: () => Promise.resolve(),
        list: () => Promise.resolve([]),
        listDirectory: () => Promise.resolve({ entries: [], totalCount: 0 }),
        select: () => Promise.resolve([]),
        mkdir: () => Promise.resolve(),
        stat: () => Promise.resolve(null),
        getDirectoryStructure: () => Promise.resolve({ files: [], directories: [] }),
        checkFileName: () => Promise.resolve({ isValid: true }),
        validateNotesDirectory: () => Promise.resolve({ isValid: true }),
        isTextFile: () => Promise.resolve(true),
        getPathForFile: (file) => file?.name || '',
        pdfInfo: () => Promise.resolve({ pageCount: 0, title: '', author: '' }),
        batchUploadMarkdown: () => Promise.resolve([]),
        startFileWatcher: () => {},
        stopFileWatcher: () => {},
        pauseFileWatcher: () => {},
        resumeFileWatcher: () => {},
        onFileChange: () => () => {},
        showInFolder: () => {},
        openFileWithRelativePath: () => {}
      },
      shell: {
        openExternal: (url) => {
          window.open(url, '_blank')
          return Promise.resolve()
        }
      },
      app: {
        getVersion: () => Promise.resolve('1.0.0'),
        getPath: () => Promise.resolve('/'),
        quit: () => {}
      },
      // Additional app methods
      getAppInfo: () =>
        Promise.resolve({
          version: '1.0.0',
          isPackaged: true,
          appPath: '',
          filesPath: '',
          appDataPath: '',
          logsPath: '',
          locale: navigator.language || 'en-US',
          isLinux: false,
          isMac: false,
          isWindows: false,
          arch: 'x64',
          platform: 'browser'
        }),
      getDiskInfo: () => Promise.resolve(null),
      reload: () => Promise.resolve(),
      window: {
        minimize: () => {},
        maximize: () => {},
        close: () => {},
        isMaximized: () => Promise.resolve(false)
      },
      mcp: {
        removeServer: () => Promise.resolve(),
        restartServer: () => Promise.resolve(),
        stopServer: () => Promise.resolve(),
        listTools: () => Promise.resolve([]),
        callTool: () => Promise.resolve({}),
        listPrompts: () => Promise.resolve([]),
        getPrompt: () => Promise.resolve({ messages: [] }),
        listResources: () => Promise.resolve([]),
        getResource: () => Promise.resolve({ contents: [] }),
        getInstallInfo: () => Promise.resolve({ installed: false }),
        checkMcpConnectivity: () => Promise.resolve({ connected: false }),
        uploadDxt: () => Promise.resolve({ success: false }),
        abortTool: () => Promise.resolve(),
        getServerVersion: () => Promise.resolve(null),
        getServerLogs: () => Promise.resolve([]),
        onServerLog: () => () => {}
      },
      // logToMain is at the top level, not under logger
      logToMain: () => Promise.resolve(),
      // Also add other common API methods as no-ops
      setFullScreen: () => {},
      isFullScreen: () => Promise.resolve(false),
      clearCache: () => Promise.resolve()
    }
  }

  if (!window.electron) {
    window.electron = {
      process: {
        platform: 'browser',
        versions: { chrome: navigator.userAgent }
      },
      ipcRenderer: {
        on: () => () => {},
        once: () => () => {},
        removeListener: () => {},
        removeAllListeners: () => {},
        send: () => {},
        invoke: () => Promise.resolve(null)
      }
    }
  }

  console.log('[Shim Init] window.api stub initialized (will be replaced by full shim)')
})()
