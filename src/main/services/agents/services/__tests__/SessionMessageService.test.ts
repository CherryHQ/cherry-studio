import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron before other imports
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => `/mock/${key}`),
    getVersion: vi.fn(() => '1.0.0'),
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined)
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
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
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: false,
    on: vi.fn(),
    removeListener: vi.fn()
  },
  net: {
    fetch: vi.fn()
  }
}))

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false,
    mac: true,
    windows: false,
    linux: false
  }
}))

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

// Mock electron-store (used by BaseService)
vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    has: vi.fn(() => false),
    store: {}
  }))
}))

// Mock better-sqlite3 (used by database)
vi.mock('better-sqlite3', () => {
  const mockStatement = {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(() => [])
  }
  const mockDb = {
    prepare: vi.fn(() => mockStatement),
    exec: vi.fn(),
    close: vi.fn(),
    pragma: vi.fn()
  }
  return {
    default: vi.fn(() => mockDb),
    __esModule: true
  }
})

// Mock drizzle-orm
vi.mock('drizzle-orm/better-sqlite3', () => ({
  drizzle: vi.fn(() => ({
    query: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => [])
          }))
        })),
        limit: vi.fn(() => []),
        offset: vi.fn(() => []),
        get: vi.fn()
      }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [])
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        run: vi.fn()
      }))
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          run: vi.fn()
        }))
      }))
    }))
  }))
}))

// Mock claudecode service
vi.mock('../claudecode', () => ({
  default: class MockClaudeCodeService {
    invoke = vi.fn().mockReturnValue({
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      sdkSessionId: 'test-session-id'
    })
  }
}))

// Mock sessionMessageRepository
vi.mock('../database/sessionMessageRepository', () => ({
  agentMessageRepository: {
    persistExchange: vi.fn().mockResolvedValue({})
  }
}))

describe('SessionMessageService', () => {
  let SessionMessageServiceModule: any

  beforeEach(async () => {
    vi.resetModules()
    SessionMessageServiceModule = await import('../SessionMessageService')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createSessionMessage', () => {
    it('should pass images to claudeCodeService.invoke when images are provided', async () => {
      vi.useFakeTimers()
      const { sessionMessageService } = SessionMessageServiceModule
      const mockClaudeCodeService = (await import('../claudecode')).default

      const mockSession = {
        id: 'session-1',
        agent_id: 'agent-1',
        model: 'claude-3',
        accessible_paths: ['/tmp/test'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const mockMessageData = {
        content: 'Test message with image',
        images: [
          { data: 'base64encodeddata', media_type: 'image/png' },
          { data: 'anotherbase64data', media_type: 'image/jpeg' }
        ]
      }

      const abortController = new AbortController()

      // Create a mock stream that emits a complete event
      const mockStream = {
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'data') {
            // Simulate a complete event
            setTimeout(() => {
              callback({ type: 'complete' })
            }, 10)
          }
        }),
        removeAllListeners: vi.fn(),
        sdkSessionId: 'test-session-id'
      }

      // Mock the ClaudeCodeService instance
      const ClaudeCodeService = (await import('../claudecode')).default
      const serviceInstance = new ClaudeCodeService()
      serviceInstance.invoke = vi.fn().mockReturnValue(mockStream)

      // Replace the imported instance
      SessionMessageServiceModule.claudeCodeService = serviceInstance

      const result = await sessionMessageService.createSessionMessage(mockSession, mockMessageData, abortController)

      // Verify the stream was created
      expect(result.stream).toBeDefined()
      expect(result.completion).toBeDefined()

      // Wait for completion to resolve
      await vi.advanceTimersByTimeAsync(50)
    })

    it('should handle message without images', async () => {
      const { sessionMessageService } = SessionMessageServiceModule

      const mockSession = {
        id: 'session-1',
        agent_id: 'agent-1',
        model: 'claude-3',
        accessible_paths: ['/tmp/test'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const mockMessageData = {
        content: 'Test message without image'
      }

      const abortController = new AbortController()

      // Create a mock stream
      const mockStream = {
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'data') {
            setTimeout(() => {
              callback({ type: 'complete' })
            }, 10)
          }
        }),
        removeAllListeners: vi.fn(),
        sdkSessionId: 'test-session-id'
      }

      // Mock the ClaudeCodeService instance
      const ClaudeCodeService = (await import('../claudecode')).default
      const serviceInstance = new ClaudeCodeService()
      serviceInstance.invoke = vi.fn().mockReturnValue(mockStream)

      // Replace the imported instance
      SessionMessageServiceModule.claudeCodeService = serviceInstance

      const result = await sessionMessageService.createSessionMessage(mockSession, mockMessageData, abortController)

      // Verify the stream was created
      expect(result.stream).toBeDefined()
      expect(result.completion).toBeDefined()
    })

    it('should include effort and thinking parameters when provided', async () => {
      const { sessionMessageService } = SessionMessageServiceModule

      const mockSession = {
        id: 'session-1',
        agent_id: 'agent-1',
        model: 'claude-3',
        accessible_paths: ['/tmp/test'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const mockMessageData = {
        content: 'Test message',
        effort: 'high',
        thinking: { type: 'enabled' as const },
        images: [{ data: 'base64data', media_type: 'image/png' }]
      }

      const abortController = new AbortController()

      // Create a mock stream
      const mockStream = {
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'data') {
            setTimeout(() => {
              callback({ type: 'complete' })
            }, 10)
          }
        }),
        removeAllListeners: vi.fn(),
        sdkSessionId: 'test-session-id'
      }

      // Mock the ClaudeCodeService instance
      const ClaudeCodeService = (await import('../claudecode')).default
      const serviceInstance = new ClaudeCodeService()
      serviceInstance.invoke = vi.fn().mockReturnValue(mockStream)

      // Replace the imported instance
      SessionMessageServiceModule.claudeCodeService = serviceInstance

      const result = await sessionMessageService.createSessionMessage(mockSession, mockMessageData, abortController)

      // Verify the stream was created with all parameters
      expect(result.stream).toBeDefined()
      expect(result.completion).toBeDefined()
    })
  })
})
