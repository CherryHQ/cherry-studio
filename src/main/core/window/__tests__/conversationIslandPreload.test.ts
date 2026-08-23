import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  off: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (...args: unknown[]) => mocks.exposeInMainWorld(...args) },
  ipcRenderer: {
    invoke: (...args: unknown[]) => mocks.invoke(...args),
    off: (...args: unknown[]) => mocks.off(...args),
    on: (...args: unknown[]) => mocks.on(...args),
    removeListener: (...args: unknown[]) => mocks.removeListener(...args)
  }
}))

vi.mock('@shared/IpcChannel', () => {
  throw new Error('Sandboxed Conversation Island preload must stay self-contained')
})

interface ConversationIslandPreloadApi {
  preference: {
    get: (key: string) => Promise<unknown>
    getMultipleRaw: (keys: string[]) => Promise<unknown>
    onChanged: (callback: (key: string, value: unknown) => void) => () => void
    set: (key: string, value: unknown) => Promise<unknown>
    subscribe: (keys: string[]) => Promise<unknown>
  }
}

interface ConversationIslandElectronApi {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  }
  process: {
    env: { NODE_ENV?: string }
    platform: string
  }
}

describe('Conversation Island preload', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('exposes only the preference operations required by the island runtime', async () => {
    await import('../../../../preload/conversationIsland')

    const api = mocks.exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as ConversationIslandPreloadApi

    expect(Object.keys(api.preference).sort()).toEqual(['get', 'getMultipleRaw', 'onChanged', 'set', 'subscribe'])

    await api.preference.getMultipleRaw(['app.language', 'ui.theme_mode'])
    expect(mocks.invoke).toHaveBeenCalledWith('preference:get-multiple-raw', ['app.language', 'ui.theme_mode'])

    await api.preference.set('ui.theme_mode', 'dark')
    expect(mocks.invoke).toHaveBeenCalledWith('preference:set', 'ui.theme_mode', 'dark')

    await expect(api.preference.get('feature.quick_assistant.assistant_id')).rejects.toThrow(
      'Preference is not available to Conversation Island'
    )
    expect(mocks.invoke).not.toHaveBeenCalledWith('preference:get', 'feature.quick_assistant.assistant_id')

    const callback = vi.fn()
    const dispose = api.preference.onChanged(callback)
    const listener = mocks.on.mock.calls.find(([channel]) => channel === 'preference:changed')?.[1]
    listener({}, 'ui.theme_mode', 'dark')
    expect(callback).toHaveBeenCalledWith('ui.theme_mode', 'dark')

    dispose()
    expect(mocks.off).toHaveBeenCalledWith('preference:changed', listener)

    const electron = mocks.exposeInMainWorld.mock.calls.find(
      ([name]) => name === 'electron'
    )?.[1] as ConversationIslandElectronApi
    expect(electron.process).toEqual({ platform: process.platform, env: { NODE_ENV: process.env.NODE_ENV } })

    await electron.ipcRenderer.invoke('app:log-to-main', { level: 'error' })
    expect(mocks.invoke).toHaveBeenCalledWith('app:log-to-main', { level: 'error' })

    await expect(electron.ipcRenderer.invoke('shell:open-external', 'https://example.com')).rejects.toThrow(
      'IPC channel is not available to Conversation Island'
    )
  })
})
