import { BrowserWindow, ipcMain, session, shell, Rectangle } from 'electron'

import { appConfig, titleBarOverlayDark, titleBarOverlayLight } from './config'
import { AgentMultiplexerService } from './services/AgentMultiplexerService';
import { BrowserViewManagerService } from './services/BrowserViewManagerService';
import { HuggingFaceService } from './services/HuggingFaceService';
import { GitHubService } from './services/GitHubService'; // Added
import AppUpdater from './services/AppUpdater'
import BackupManager from './services/BackupManager'
import FileManager from './services/FileManager'
import { compress, decompress } from './utils/zip'
import { createMinappWindow } from './window'

const fileManager = new FileManager()
const backupManager = new BackupManager()

export function registerIpc(
  mainWindow: BrowserWindow,
  app: Electron.App,
  agentMultiplexerService: AgentMultiplexerService,
  browserViewManagerService: BrowserViewManagerService,
  huggingFaceService: HuggingFaceService,
  githubService: GitHubService // Added
) {
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

  // BrowserViewManagerService IPC Handlers
  ipcMain.handle('browserView:create', (_, viewId: string, hostWindowId?: number, initialUrl?: string) => {
    const actualHostWindowId = hostWindowId === undefined ? mainWindow.id : hostWindowId;
    return browserViewManagerService.createBrowserView(viewId, actualHostWindowId, initialUrl);
  });

  ipcMain.handle('browserView:destroy', (_, viewId: string) => {
    return browserViewManagerService.destroyBrowserView(viewId);
  });

  ipcMain.handle('browserView:setBounds', (_, viewId: string, bounds: Electron.Rectangle) => {
    return browserViewManagerService.setBounds(viewId, bounds);
  });

  ipcMain.handle('browserView:showView', (_, viewId: string, hostWindowId?: number) => {
    const actualHostWindowId = hostWindowId === undefined ? mainWindow.id : hostWindowId;
    return browserViewManagerService.showView(viewId, actualHostWindowId);
  });

  ipcMain.handle('browserView:hideView', (_, viewId: string) => {
    return browserViewManagerService.hideView(viewId);
  });

  ipcMain.handle('browserView:navigateTo', (_, viewId: string, url: string) => {
    return browserViewManagerService.navigateTo(viewId, url);
  });

  ipcMain.handle('browserView:goBack', (_, viewId: string) => {
    return browserViewManagerService.goBack(viewId);
  });

  ipcMain.handle('browserView:goForward', (_, viewId: string) => {
    return browserViewManagerService.goForward(viewId);
  });

  ipcMain.handle('browserView:reload', (_, viewId: string) => {
    return browserViewManagerService.reload(viewId);
  });

  ipcMain.handle('browserView:openDevTools', (_, viewId: string) => {
    return browserViewManagerService.openDevTools(viewId);
  });

  ipcMain.handle('browserView:getCurrentURL', (_, viewId: string) => {
    return browserViewManagerService.getCurrentURL(viewId);
  });
  ipcMain.handle('browserView:canGoBack', (_, viewId: string) => {
    return browserViewManagerService.canGoBack(viewId);
  });
  ipcMain.handle('browserView:canGoForward', (_, viewId: string) => {
    return browserViewManagerService.canGoForward(viewId);
  });

  // HuggingFaceService IPC Handlers
  ipcMain.handle('huggingFace:listModels', async (_, search?: string, author?: string, tags?: string[], limit?: number, full?: boolean) => {
    try {
      return await huggingFaceService.listModels(search, author, tags, limit, full);
    } catch (error: any) {
      console.error('IPC Error huggingFace:listModels:', error);
      // Ensure a serializable error object is returned
      return { error: { message: error.message, name: error.name, stack: error.stack } };
    }
  });

  ipcMain.handle('huggingFace:getModelInfo', async (_, modelId: string) => {
    try {
      return await huggingFaceService.getModelInfo(modelId);
    } catch (error: any) {
      console.error('IPC Error huggingFace:getModelInfo:', error);
      return { error: { message: error.message, name: error.name, stack: error.stack } };
    }
  });

  ipcMain.handle('huggingFace:getSpaceInfo', async (_, spaceId: string) => {
    try {
      return await huggingFaceService.getSpaceInfo(spaceId);
    } catch (error: any) {
      console.error('IPC Error huggingFace:getSpaceInfo:', error);
      return { error: { message: error.message, name: error.name, stack: error.stack } };
    }
  });

  ipcMain.handle('huggingFace:getSpaceUrl', (_, spaceId: string) => {
    // This method is synchronous in the service
    try {
      return huggingFaceService.getSpaceUrl(spaceId);
    } catch (error: any) { // Should not happen for this sync method unless spaceId is problematic
      console.error('IPC Error huggingFace:getSpaceUrl:', error);
      return { error: { message: error.message, name: error.name, stack: error.stack } };
    }
  });

  // GitHubService IPC Handlers
  ipcMain.handle('github:getRepoInfo', async (_, owner: string, repo: string) => {
    try {
      return await githubService.getRepoInfo(owner, repo);
    } catch (error: any) {
      console.error('IPC Error github:getRepoInfo:', error);
      return { error: { message: error.message, name: error.name, stack: error.stack } };
    }
  });

  ipcMain.handle('github:getRepoContents', async (_, owner: string, repo: string, contentPath: string = '', ref?: string) => {
    try {
      return await githubService.getRepoContents(owner, repo, contentPath, ref);
    } catch (error: any) {
      console.error('IPC Error github:getRepoContents:', error);
      return { error: { message: error.message, name: error.name, stack: error.stack } };
    }
  });

  ipcMain.handle('github:getFileContent', async (_, owner: string, repo: string, filePath: string, ref?: string) => {
    try {
      const content = await githubService.getFileContent(owner, repo, filePath, ref);
      return { content }; // Wrap in an object for consistency
    } catch (error: any) {
      console.error('IPC Error github:getFileContent:', error);
      return { error: { message: error.message, name: error.name, stack: error.stack } };
    }
  });

  ipcMain.handle('github:listUserRepos', async (_, username: string, type?: 'all' | 'owner' | 'member', sort?: 'created' | 'updated' | 'pushed' | 'full_name', direction?: 'asc' | 'desc', perPage?: number, page?: number) => {
    try {
      return await githubService.listUserRepos(username, type, sort, direction, perPage, page);
    } catch (error: any) {
      console.error('IPC Error github:listUserRepos:', error);
      return { error: { message: error.message, name: error.name, stack: error.stack } };
    }
  });
}
