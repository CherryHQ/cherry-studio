import '@testing-library/jest-dom/vitest'

import { createRequire } from 'node:module'
import { styleSheetSerializer } from 'jest-styled-components/serializer'
import { createRequire } from 'node:module'
import { expect, vi } from 'vitest'
import * as bufferModule from 'buffer'

const require = createRequire(import.meta.url)

const require = createRequire(import.meta.url)
const bufferModule = require('buffer')
if (!bufferModule.SlowBuffer) {
  bufferModule.SlowBuffer = bufferModule.Buffer
}

expect.addSnapshotSerializer(styleSheetSerializer)

// Provide SlowBuffer compatibility for dependencies expecting it
// (Node 20+ deprecates/removed SlowBuffer)
if (!(bufferModule as any).SlowBuffer) {
  ;(bufferModule as any).SlowBuffer = Buffer
}
if (!(Buffer as any).SlowBuffer) {
  ;(Buffer as any).SlowBuffer = Buffer
}
if (!(Buffer as any).prototype.equal) {
  ;(Buffer as any).prototype.equal = Buffer.prototype.equals
}
;(globalThis as any).SlowBuffer = (bufferModule as any).SlowBuffer

// Hard mock buffer-equal-constant-time before any require() usage (fixes Node 20+ removal of SlowBuffer)
try {
  const bectPath = require.resolve('buffer-equal-constant-time')
  const mockFn = (a: any, b: any) => {
    if (a && b && typeof a.equals === 'function') return a.equals(b)
    return a === b
  }
  require.cache[bectPath] = {
    id: bectPath,
    filename: bectPath,
    loaded: true,
    exports: mockFn
  }
} catch (err) {
  // ignore if not resolvable in context
}

// Mock LoggerService globally for renderer tests
vi.mock('@logger', async () => {
  const { MockRendererLoggerService, mockRendererLoggerService } = await import('./__mocks__/RendererLoggerService')
  return {
    LoggerService: MockRendererLoggerService,
    loggerService: mockRendererLoggerService
  }
})

// Mock uuid globally for renderer tests
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => 'test-uuid-' + ++uuidCounter
}))

vi.mock('axios', () => {
  const defaultAxiosMock = {
    get: vi.fn().mockResolvedValue({ data: {} }), // Mocking axios GET request
    post: vi.fn().mockResolvedValue({ data: {} }) // Mocking axios POST request
    // You can add other axios methods like put, delete etc. as needed
  }

  const isAxiosError = (error: unknown): error is { isAxiosError?: boolean } =>
    Boolean((error as { isAxiosError?: boolean } | undefined)?.isAxiosError)

  return {
    default: defaultAxiosMock,
    isAxiosError
  }
})

// Mock ResizeObserver for jsdom environment
vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)

vi.stubGlobal('electron', {
  ipcRenderer: {
    on: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn().mockResolvedValue(undefined)
  }
})
vi.stubGlobal('api', {
  file: {
    read: vi.fn().mockResolvedValue('[]'),
    writeWithId: vi.fn().mockResolvedValue(undefined)
  }
})

// 提供浏览器环境全局（i18n 等模块依赖）
if (typeof globalThis.localStorage === 'undefined' || typeof (globalThis.localStorage as any).getItem !== 'function') {
  let store = new Map<string, string>()

  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    }
  }

  vi.stubGlobal('localStorage', localStorageMock)
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock })
  }
}

if (typeof (globalThis as any).navigator === 'undefined') {
  vi.stubGlobal('navigator', {
    language: 'en-US',
    languages: ['en-US'],
    userAgent: 'vitest'
  })
}

// 某些依赖会直接 import 它，这里再用 vi.mock 兜底一次（与 require.cache 注入保持一致）
vi.mock('buffer-equal-constant-time', () => {
  const fn = (a: any, b: any) => {
    if (a && b && typeof a.equals === 'function') return a.equals(b)
    return a === b
  }
  return fn
})
