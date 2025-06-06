import { BrowserWindow, ipcMain, session, shell } from 'electron'

import { appConfig, titleBarOverlayDark, titleBarOverlayLight } from './config'
import { AgentMultiplexerService } from './services/AgentMultiplexerService';
import AppUpdater from './services/AppUpdater'
import BackupManager from './services/BackupManager'
import FileManager from './services/FileManager'
import { compress, decompress } from './utils/zip'
import { createMinappWindow } from './window'

const fileManager = new FileManager()
const backupManager = new BackupManager()

export function registerIpc(mainWindow: BrowserWindow, app: Electron.App, agentMultiplexerService: AgentMultiplexerService) {
  const { autoUpdater } = new AppUpdater(mainWindow)

  // IPC
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath()
  }))

  ipcMain.handle('open-website', (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('set-proxy', (_, proxy: string) => {
    session.defaultSession.setProxy(proxy ? { proxyRules: proxy } : {})
  })

  ipcMain.handle('reload', () => mainWindow.reload())

  ipcMain.handle('zip:compress', (_, text: string) => compress(text))
  ipcMain.handle('zip:decompress', (_, text: Buffer) => decompress(text))
  ipcMain.handle('backup:backup', backupManager.backup)
  ipcMain.handle('backup:restore', backupManager.restore)
  ipcMain.handle('backup:backupToWebdav', backupManager.backupToWebdav)
  ipcMain.handle('backup:restoreFromWebdav', backupManager.restoreFromWebdav)

  ipcMain.handle('file:open', fileManager.open)
  ipcMain.handle('file:save', fileManager.save)
  ipcMain.handle('file:select', fileManager.selectFile)
  ipcMain.handle('file:upload', fileManager.uploadFile)
  ipcMain.handle('file:clear', fileManager.clear)
  ipcMain.handle('file:read', fileManager.readFile)
  ipcMain.handle('file:delete', fileManager.deleteFile)
  ipcMain.handle('file:get', fileManager.getFile)
  ipcMain.handle('file:selectFolder', fileManager.selectFolder)
  ipcMain.handle('file:create', fileManager.createTempFile)
  ipcMain.handle('file:write', fileManager.writeFile)
  ipcMain.handle('file:saveImage', fileManager.saveImage)
  ipcMain.handle('file:base64Image', fileManager.base64Image)

  ipcMain.handle('minapp', (_, args) => {
    createMinappWindow({
      url: args.url,
      parent: mainWindow,
      windowOptions: {
        ...mainWindow.getBounds(),
        ...args.windowOptions
      }
    })
  })

  ipcMain.handle('set-theme', (_, theme: 'light' | 'dark') => {
    appConfig.set('theme', theme)
    mainWindow?.setTitleBarOverlay &&
      mainWindow.setTitleBarOverlay(theme === 'dark' ? titleBarOverlayDark : titleBarOverlayLight)
  })

  // 触发检查更新(此方法用于被渲染线程调用，例如页面点击检查更新按钮来调用此方法)
  ipcMain.handle('check-for-update', async () => {
    return {
      currentVersion: autoUpdater.currentVersion,
      update: await autoUpdater.checkForUpdates()
    }
  })

  // Agent Multiplexer Service IPC Handlers
  ipcMain.handle('agentMultiplexer:addAgent', async (_, agentId: string, name: string, persona: string, model: string, objective: string | null) => {
    try {
      const success = agentMultiplexerService.addAgent(agentId, name, persona, model, objective);
      return { success };
    } catch (error: any) {
      console.error('IPC Error agentMultiplexer:addAgent:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('agentMultiplexer:removeAgent', async (_, agentId: string) => {
    try {
      const success = agentMultiplexerService.removeAgent(agentId);
      return { success };
    } catch (error: any) {
      console.error('IPC Error agentMultiplexer:removeAgent:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('agentMultiplexer:sendMessage', async (_, agentId: string, message: string, images?: string[]) => {
    try {
      const response = await agentMultiplexerService.sendMessageToAgent(agentId, message, images);
      return { response }; // response can be string (AI message) or null (error/busy)
    } catch (error: any) {
      console.error('IPC Error agentMultiplexer:sendMessage:', error);
      return { response: null, error: error.message };
    }
  });
}
