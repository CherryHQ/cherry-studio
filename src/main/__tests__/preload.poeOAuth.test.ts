import { afterEach, describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'

describe('preload Poe OAuth bridge', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as NodeJS.Process & { contextIsolated: boolean }).contextIsolated = false
  })

  it('exposes provider.poeOAuthLogin through ipcRenderer.invoke', async () => {
    const exposeInMainWorld = vi.fn()
    const invoke = vi.fn().mockResolvedValue({ apiKey: 'poe-api-key', expiresIn: 3600 })

    ;(process as NodeJS.Process & { contextIsolated?: boolean }).contextIsolated = true

    vi.doMock('@electron-toolkit/preload', () => ({
      electronAPI: {}
    }))

    vi.doMock('electron', () => ({
      contextBridge: {
        exposeInMainWorld
      },
      ipcRenderer: {
        invoke,
        on: vi.fn(),
        off: vi.fn()
      },
      shell: {
        openExternal: vi.fn()
      },
      webUtils: {
        getPathForFile: vi.fn()
      }
    }))

    await import('../../preload/index')

    const exposedApi = exposeInMainWorld.mock.calls.find(([key]) => key === 'api')?.[1]

    expect(exposedApi).toBeTruthy()

    await exposedApi.provider.poeOAuthLogin()

    expect(invoke).toHaveBeenCalledWith(IpcChannel.Provider_PoeOAuthLogin)
  })
})
