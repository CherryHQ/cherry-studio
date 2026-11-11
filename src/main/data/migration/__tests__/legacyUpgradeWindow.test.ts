import { EventEmitter } from 'node:events'

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { validateSender } from '@main/core/security/validateSender'
import { LegacyUpgradeChannels, type LegacyUpgradeScreen } from '@shared/types/legacyUpgrade'

import { showLegacyUpgradeWindow } from '../legacyUpgradeWindow'

vi.mock('@main/core/security/validateSender', () => ({ validateSender: vi.fn(() => true) }))

const screen: Omit<LegacyUpgradeScreen, 'dark'> = {
  title: 'Upgrade',
  olderVersions: 'Older version upgrade instructions',
  detail: 'Keep your data',
  prerequisite: 'Run 1.9.12 first',
  download: 'Download 2.1.0',
  downloadPrerequisite: 'Download 1.9.12',
  quit: 'Quit'
}
const downloads = { bridge: 'https://example.com/2.1.0.dmg', prerequisite: 'https://example.com/1.9.12.dmg' }

function createWindow() {
  let destroyed = false
  const window = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler: vi.fn() }),
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true
      window.emit('closed')
    },
    show: vi.fn(),
    loadFile: vi.fn().mockResolvedValue(undefined),
    loadURL: vi.fn().mockResolvedValue(undefined)
  })
  return window
}
let window: ReturnType<typeof createWindow>
let handlers: Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>
const event = () =>
  ({ sender: window.webContents, senderFrame: window.webContents.mainFrame }) as unknown as IpcMainInvokeEvent

beforeEach(() => {
  vi.clearAllMocks()
  window = createWindow()
  handlers = new Map()
  vi.mocked(BrowserWindow).mockImplementation(function () {
    return window as unknown as BrowserWindow
  })
  vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
    handlers.set(channel, handler)
  })
  vi.mocked(ipcMain.removeHandler).mockImplementation((channel) => {
    handlers.delete(channel)
  })
  vi.mocked(shell.openExternal).mockResolvedValue(undefined)
  vi.mocked(validateSender).mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

describe('preboot upgrade window boundary', () => {
  it.each(['bridge', 'prerequisite'] as const)(
    'opens only the fixed %s installer and retires its IPC',
    async (target) => {
      const closed = showLegacyUpgradeWindow(screen, downloads)
      await handlers.get(LegacyUpgradeChannels.Download)!(event(), target)
      await closed
      expect(shell.openExternal).toHaveBeenCalledWith(downloads[target])
      expect(window.isDestroyed()).toBe(true)
      expect(handlers.size).toBe(0)
    }
  )

  it('rejects arbitrary URLs, other windows and subframes without opening anything', async () => {
    const closed = showLegacyUpgradeWindow(screen, downloads)
    const download = handlers.get(LegacyUpgradeChannels.Download)!
    await expect(download(event(), 'https://attacker.example')).rejects.toThrow('Invalid upgrade download')
    await expect(download({ ...event(), senderFrame: null }, 'bridge')).rejects.toThrow('Untrusted')
    await expect(download({ ...event(), sender: {} as IpcMainInvokeEvent['sender'] }, 'bridge')).rejects.toThrow(
      'Untrusted'
    )
    vi.mocked(validateSender).mockReturnValue(false)
    await expect(download(event(), 'bridge')).rejects.toThrow('Untrusted')
    expect(shell.openExternal).not.toHaveBeenCalled()
    window.destroy()
    await closed
    expect(handlers.size).toBe(0)
  })

  it('closes without a download when the user quits', async () => {
    const closed = showLegacyUpgradeWindow(screen, downloads)
    handlers.get(LegacyUpgradeChannels.Quit)!(event())
    await closed
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(handlers.size).toBe(0)
  })

  it('propagates a failed download to the native error fallback and cleans up', async () => {
    vi.mocked(shell.openExternal).mockRejectedValue(new Error('No browser'))
    const closed = showLegacyUpgradeWindow(screen, downloads)
    const rejected = expect(closed).rejects.toThrow('No browser')
    await handlers.get(LegacyUpgradeChannels.Download)!(event(), 'bridge')
    await rejected
    expect(handlers.size).toBe(0)
    expect(window.isDestroyed()).toBe(true)
  })
})
