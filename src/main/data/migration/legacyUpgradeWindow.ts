import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, nativeTheme, shell } from 'electron'

import { application } from '@application'
import { isDev } from '@main/core/platform'
import { validateSender } from '@main/core/security/validateSender'
import { LegacyUpgradeChannels, type LegacyUpgradeScreen } from '@shared/types/legacyUpgrade'

// Preboot has no lifecycle WindowManager or IpcApiService; like relocation,
// this isolated window owns its IPC only until it closes.
export function showLegacyUpgradeWindow(
  screen: Omit<LegacyUpgradeScreen, 'dark'>,
  downloads: { bridge: string; prerequisite: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({
      width: 640,
      height: 700,
      minWidth: 560,
      minHeight: 660,
      show: false,
      autoHideMenuBar: true,
      title: 'Cherry Studio',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
      webPreferences: {
        preload: application.getPath('app.root', 'out/preload/simplest.js'),
        partition: 'legacy-upgrade',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      for (const channel of Object.values(LegacyUpgradeChannels)) ipcMain.removeHandler(channel)
      if (!window.isDestroyed()) window.destroy()
      if (error) reject(error)
      else resolve()
    }
    const timeout = setTimeout(() => finish(new Error('Upgrade window did not load')), 30_000)
    const guard = (event: IpcMainInvokeEvent) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        !validateSender(event)
      ) {
        throw new Error('Untrusted upgrade window request')
      }
    }
    ipcMain.handle(LegacyUpgradeChannels.GetScreen, (event) => {
      guard(event)
      clearTimeout(timeout)
      return { ...screen, dark: nativeTheme.shouldUseDarkColors } satisfies LegacyUpgradeScreen
    })
    let downloading = false
    ipcMain.handle(LegacyUpgradeChannels.Download, async (event, target: unknown) => {
      guard(event)
      if (target !== 'bridge' && target !== 'prerequisite') throw new Error('Invalid upgrade download')
      if (downloading) return
      downloading = true
      try {
        await shell.openExternal(downloads[target])
        finish()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    ipcMain.handle(LegacyUpgradeChannels.Quit, (event) => {
      guard(event)
      finish()
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.once('render-process-gone', () => finish(new Error('Upgrade window renderer exited')))
    window.once('closed', () => finish())
    window.once('ready-to-show', () => window.show())
    const loading =
      isDev && process.env.ELECTRON_RENDERER_URL
        ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/windows/legacyUpgrade/index.html`)
        : window.loadFile(application.getPath('app.root', 'out/renderer/windows/legacyUpgrade/index.html'))
    void loading.catch((error: Error) => finish(error))
  })
}
