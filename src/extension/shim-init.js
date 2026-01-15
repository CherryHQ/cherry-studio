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
        mkdir: () => Promise.resolve(),
        stat: () => Promise.resolve(null)
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
      window: {
        minimize: () => {},
        maximize: () => {},
        close: () => {},
        isMaximized: () => Promise.resolve(false)
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
