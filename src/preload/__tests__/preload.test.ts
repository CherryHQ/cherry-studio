import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'
import { IpcChannel } from '@shared/IpcChannel'

const { invoke, openExternal, exposed } = vi.hoisted(() => ({
  invoke: vi.fn(),
  openExternal: vi.fn(),
  exposed: new Map<string, unknown>()
}))
vi.mock('@electron-toolkit/preload', () => ({ electronAPI: {} }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => exposed.set(key, api) },
  ipcRenderer: { invoke, on: vi.fn() },
  shell: { openExternal },
  webUtils: { getPathForFile: vi.fn() }
}))

Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
await import('../preload')
const api = exposed.get('api') as {
  shell: { openExternal: (url: string, options?: Electron.OpenExternalOptions) => Promise<void> }
}

describe('preload external URL bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ ok: true, data: undefined })
  })
  it('rejects invalid schemes before IPC', async () => {
    await expect(api.shell.openExternal('javascript:alert(2)')).rejects.toThrow('Blocked openExternal')
    expect(invoke).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })
  it('forwards an application URL and options through IpcApi and resolves void', async () => {
    const url = 'obsidian://new?file=Note'
    const options = { activate: false, workingDirectory: '/tmp', logUsage: true }
    await expect(api.shell.openExternal(url, options)).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      IpcChannel.IpcApi_Request,
      'system.shell.open_external_website',
      { url, options },
      undefined
    )
    expect(openExternal).not.toHaveBeenCalled()
  })
  it('reconstructs error envelopes instead of treating failure as success', async () => {
    invoke.mockResolvedValue({
      ok: false,
      error: { code: 'OPEN_FAILED', message: 'Cannot open', data: { reason: 'unavailable' } }
    })
    await expect(api.shell.openExternal('https://example.test')).rejects.toEqual(
      new IpcError('OPEN_FAILED', 'Cannot open', { reason: 'unavailable' })
    )
    expect(openExternal).not.toHaveBeenCalled()
  })
  it.each([
    undefined,
    null,
    {},
    { ok: true },
    { ok: true, data: 'unexpected' },
    { ok: false },
    { ok: false, error: {} },
    { ok: 'true', data: undefined }
  ])('rejects malformed envelopes: %j', async (envelope) => {
    invoke.mockResolvedValue(envelope)
    await expect(api.shell.openExternal('https://example.test')).rejects.toThrow('Invalid IpcApi result')
    expect(openExternal).not.toHaveBeenCalled()
  })
})
