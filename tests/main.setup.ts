import { vi } from 'vitest'

// Mock LoggerService globally for main process tests
vi.mock('@logger', async () => {
  const { MockMainLoggerService, mockMainLoggerService } = await import('./__mocks__/MainLoggerService')
  return {
    LoggerService: MockMainLoggerService,
    loggerService: mockMainLoggerService
  }
})

// Mock service modules globally for main tests.
// These mocks export both the class and instance names for backward compat.
vi.mock('@main/data/PreferenceService', async () => {
  const { MockMainPreferenceServiceExport } = await import('./__mocks__/main/PreferenceService')
  return {
    ...MockMainPreferenceServiceExport,
    PreferenceService: vi.fn() // Class export for serviceRegistry
  }
})

vi.mock('@main/data/DataApiService', async () => {
  const { MockMainDataApiServiceExport } = await import('./__mocks__/main/DataApiService')
  return {
    ...MockMainDataApiServiceExport,
    DataApiService: vi.fn() // Class export for serviceRegistry
  }
})

vi.mock('@main/data/CacheService', async () => {
  const { MockMainCacheServiceExport } = await import('./__mocks__/main/CacheService')
  return {
    ...MockMainCacheServiceExport,
    CacheService: vi.fn() // Class export for serviceRegistry
  }
})

vi.mock('@main/data/db/DbService', async () => {
  const { MockMainDbServiceExport } = await import('./__mocks__/main/DbService')
  return {
    ...MockMainDbServiceExport,
    DbService: vi.fn() // Class export for serviceRegistry
  }
})

// Mock application globally - provides type-safe service access via application.get()
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('./__mocks__/main/application')
  return mockApplicationFactory()
})

// Mock electron modules that are commonly used in main process
vi.mock('electron', () => {
  const mock = {
    app: {
      getPath: vi.fn((key: string) => {
        switch (key) {
          case 'userData':
            return '/mock/userData'
          case 'temp':
            return '/mock/temp'
          case 'logs':
            return '/mock/logs'
          default:
            return '/mock/unknown'
        }
      }),
      getVersion: vi.fn(() => '1.0.0')
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeHandler: vi.fn(),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn()
    },
    BrowserWindow: vi.fn(),
    dialog: {
      showErrorBox: vi.fn(),
      showMessageBox: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn()
    },
    shell: {
      openExternal: vi.fn(),
      showItemInFolder: vi.fn()
    },
    session: {
      defaultSession: {
        clearCache: vi.fn(),
        clearStorageData: vi.fn()
      }
    },
    webContents: {
      getAllWebContents: vi.fn(() => [])
    },
    systemPreferences: {
      getMediaAccessStatus: vi.fn(),
      askForMediaAccess: vi.fn()
    },
    nativeTheme: {
      themeSource: 'system',
      shouldUseDarkColors: false,
      on: vi.fn(),
      removeListener: vi.fn()
    },
    screen: {
      getPrimaryDisplay: vi.fn(),
      getAllDisplays: vi.fn()
    },
    Notification: vi.fn(),
    net: {
      fetch: vi.fn()
    }
  }

  return { __esModule: true, ...mock, default: mock }
})

// Mock Winston for LoggerService dependencies
vi.mock('winston', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    level: 'info',
    on: vi.fn(),
    end: vi.fn()
  })),
  format: {
    combine: vi.fn(),
    splat: vi.fn(),
    timestamp: vi.fn(),
    errors: vi.fn(),
    json: vi.fn()
  },
  transports: {
    Console: vi.fn(),
    File: vi.fn()
  }
}))

// Mock winston-daily-rotate-file
vi.mock('winston-daily-rotate-file', () => {
  return vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    log: vi.fn()
  }))
})

// Mock electron-store to avoid file system operations
vi.mock('electron-store', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      has: vi.fn(() => false),
      store: {}
    }))
  }
})

// Mock Node.js modules
//
// The fs/os/path modules are passed through to their real implementations
// (`...await vi.importActual(...)`) so that third-party libraries such as
// `drizzle-orm/libsql/migrator` can read files from disk. Historically these
// modules were replaced wholesale with vi.fn() stubs, which caused any code
// reading migration files, tmp directories, or real paths to silently break.
//
// Individual tests that require controlled fs/os/path behaviour should spy
// on the specific method(s) they need (`vi.spyOn(fs, 'existsSync')`) or
// declare a local `vi.mock(..., factory)` inside the test file.
//
// `os.homedir()` is still stubbed to `/mock/home` because many existing
// tests assume this deterministic value when building expected paths.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: vi.fn(() => '/mock/home'),
    default: {
      ...actual,
      homedir: () => '/mock/home'
    }
  }
})

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path')
  return {
    ...actual,
    default: actual
  }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    default: actual
  }
})
