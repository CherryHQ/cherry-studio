import {
  app,
  autoUpdater as nativeUpdater,
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
  nativeTheme,
  shell
} from 'electron'

import { application } from '@application'
import { isDev } from '@main/core/platform'
import { validateSender } from '@main/core/security/validateSender'
import { LegacyUpgradeChannels, type LegacyUpgradeScreen } from '@shared/types/legacyUpgrade'

import { createLegacyBridgeUpdater, LegacyBridgeInstaller, prepareLegacyBridgeProfile } from './legacyBridgeInstaller'
import type { LegacyBridgeTarget } from './legacyBridgeTarget'

// Preboot has no lifecycle WindowManager or IpcApiService; like relocation,
// this isolated window owns its IPC only until it closes.
export function showLegacyUpgradeWindow(
  screen: Omit<LegacyUpgradeScreen, 'dark'>,
  downloads: { bridge: string; prerequisite: string },
  target?: LegacyBridgeTarget,
  profile?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({
      width: 520,
      height: 420,
      minWidth: 440,
      minHeight: 380,
      show: false,
      frame: false,
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
    const installer = target
      ? new LegacyBridgeInstaller(
          () => createLegacyBridgeUpdater(target),
          (state) => {
            if (!window.isDestroyed()) window.webContents.send(LegacyUpgradeChannels.State, state)
          },
          () => {
            if (!profile) throw new Error('Missing migration profile')
            return prepareLegacyBridgeProfile(profile)
          }
        )
      : undefined
    let updateQuitting = false
    const beforeUpdateQuit = () => {
      updateQuitting = true
      application.markQuitting()
    }
    const beforeQuit = (event: Electron.Event) => {
      if (installer?.installing && !updateQuitting) event.preventDefault()
    }
    nativeUpdater.on('before-quit-for-update', beforeUpdateQuit)
    app.on('before-quit', beforeQuit)
    let settled = false
    const finish = async (error?: Error) => {
      if (settled || installer?.installing) return
      settled = true
      clearTimeout(timeout)
      await installer?.dispose()
      nativeUpdater.removeListener('before-quit-for-update', beforeUpdateQuit)
      app.removeListener('before-quit', beforeQuit)
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
    ipcMain.handle(LegacyUpgradeChannels.GetState, (event) => {
      guard(event)
      return installer?.state ?? { phase: 'idle' }
    })
    ipcMain.handle(LegacyUpgradeChannels.Install, (event) => {
      guard(event)
      if (!installer || settled) throw new Error('Automatic installation unavailable')
      installer.start()
    })
    ipcMain.handle(LegacyUpgradeChannels.Cancel, async (event) => {
      guard(event)
      await installer?.cancel()
    })
    let downloading = false
    ipcMain.handle(LegacyUpgradeChannels.Download, async (event, target: unknown) => {
      guard(event)
      if (target !== 'bridge' && target !== 'prerequisite') throw new Error('Invalid upgrade download')
      if (downloading || settled || (installer && !['idle', 'failed'].includes(installer.state.phase))) return
      downloading = true
      try {
        await shell.openExternal(downloads[target])
        await finish()
      } catch (error) {
        await finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    ipcMain.handle(LegacyUpgradeChannels.Quit, (event) => {
      guard(event)
      if (installer?.installing) return
      void finish()
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.once('render-process-gone', () => finish(new Error('Upgrade window renderer exited')))
    window.on('close', (event) => {
      if (installer?.installing && !updateQuitting) event.preventDefault()
    })
    window.once('closed', () => {
      if (!installer?.installing) void finish()
    })
    window.once('ready-to-show', () => window.show())
    const loading =
      isDev && process.env.ELECTRON_RENDERER_URL
        ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/windows/legacyUpgrade/index.html`)
        : window.loadFile(application.getPath('app.root', 'out/renderer/windows/legacyUpgrade/index.html'))
    void loading.catch((error: Error) => finish(error))
  })
}
