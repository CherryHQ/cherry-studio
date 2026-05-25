import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCacheRemove = vi.fn()
const mockExecuteJavaScript = vi.fn().mockResolvedValue(undefined)
const mockGetMainWindow = vi.fn(() => ({
  webContents: {
    executeJavaScript: mockExecuteJavaScript
  }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((_channel: string, handler: () => void) => {
      handler()
    })
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('../CacheService', () => ({
  CacheService: {
    remove: (...args: unknown[]) => mockCacheRemove(...args)
  }
}))

vi.mock('../WindowService', () => ({
  windowService: {
    getMainWindow: () => mockGetMainWindow()
  }
}))

import { invalidateApiServerProvidersCacheForAction, reduxService } from '../ReduxService'

describe('ReduxService provider cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears the API server provider cache for provider mutations', async () => {
    await reduxService.dispatch({ type: 'llm/updateProvider', payload: { id: 'openai', apiKey: 'new-key' } })

    expect(mockExecuteJavaScript).toHaveBeenCalled()
    expect(mockCacheRemove).toHaveBeenCalledWith('api-server:providers')
  })

  it('does not clear the API server provider cache for unrelated actions', () => {
    invalidateApiServerProvidersCacheForAction('llm/setDefaultModel')

    expect(mockCacheRemove).not.toHaveBeenCalled()
  })
})
