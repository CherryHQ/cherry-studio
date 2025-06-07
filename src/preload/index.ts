import { electronAPI } from '@electron-toolkit/preload'
import { WebDavConfig } from '@types'
import { contextBridge, ipcRenderer, OpenDialogOptions } from 'electron'

// Custom APIs for renderer
const api = {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  openWebsite: (url: string) => ipcRenderer.invoke('open-website', url),
  setProxy: (proxy: string) => ipcRenderer.invoke('set-proxy', proxy),
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.invoke('set-theme', theme),
  minApp: (url: string) => ipcRenderer.invoke('minapp', url),
  reload: () => ipcRenderer.invoke('reload'),
  compress: (text: string) => ipcRenderer.invoke('zip:compress', text),
  decompress: (text: Buffer) => ipcRenderer.invoke('zip:decompress', text),
  backup: {
    backup: (fileName: string, data: string, destinationPath?: string) =>
      ipcRenderer.invoke('backup:backup', fileName, data, destinationPath),
    restore: (backupPath: string) => ipcRenderer.invoke('backup:restore', backupPath),
    backupToWebdav: (data: string, webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke('backup:backupToWebdav', data, webdavConfig),
    restoreFromWebdav: (webdavConfig: WebDavConfig) => ipcRenderer.invoke('backup:restoreFromWebdav', webdavConfig)
  },
  file: {
    select: (options?: OpenDialogOptions) => ipcRenderer.invoke('file:select', options),
    upload: (filePath: string) => ipcRenderer.invoke('file:upload', filePath),
    delete: (fileId: string) => ipcRenderer.invoke('file:delete', fileId),
    read: (fileId: string) => ipcRenderer.invoke('file:read', fileId),
    clear: () => ipcRenderer.invoke('file:clear'),
    get: (filePath: string) => ipcRenderer.invoke('file:get', filePath),
    create: (fileName: string) => ipcRenderer.invoke('file:create', fileName),
    write: (filePath: string, data: Uint8Array | string) => ipcRenderer.invoke('file:write', filePath, data),
    open: (options?: { decompress: boolean }) => ipcRenderer.invoke('file:open', options),
    save: (path: string, content: string, options?: { compress: boolean }) =>
      ipcRenderer.invoke('file:save', path, content, options),
    selectFolder: () => ipcRenderer.invoke('file:selectFolder'),
    saveImage: (name: string, data: string) => ipcRenderer.invoke('file:saveImage', name, data),
    base64Image: (fileId: string) => ipcRenderer.invoke('file:base64Image', fileId)
  },
  agentMultiplexer: {
    addAgent: (agentId: string, name: string, persona: string, model: string, objective: string | null = null) =>
      ipcRenderer.invoke('agentMultiplexer:addAgent', agentId, name, persona, model, objective),
    removeAgent: (agentId: string) =>
      ipcRenderer.invoke('agentMultiplexer:removeAgent', agentId),
    sendMessage: (agentId: string, message: string, images?: string[]) =>
      ipcRenderer.invoke('agentMultiplexer:sendMessage', agentId, message, images)
  },
  browserViewManager: {
    create: (viewId: string, hostWindowId?: number, initialUrl?: string) =>
      ipcRenderer.invoke('browserView:create', viewId, hostWindowId, initialUrl),
    destroy: (viewId: string) =>
      ipcRenderer.invoke('browserView:destroy', viewId),
    setBounds: (viewId: string, bounds: Electron.Rectangle) =>
      ipcRenderer.invoke('browserView:setBounds', viewId, bounds),
    showView: (viewId: string, hostWindowId?: number) =>
      ipcRenderer.invoke('browserView:showView', viewId, hostWindowId),
    hideView: (viewId: string) =>
      ipcRenderer.invoke('browserView:hideView', viewId),
    navigateTo: (viewId: string, url: string) =>
      ipcRenderer.invoke('browserView:navigateTo', viewId, url),
    goBack: (viewId: string) =>
      ipcRenderer.invoke('browserView:goBack', viewId),
    goForward: (viewId: string) =>
      ipcRenderer.invoke('browserView:goForward', viewId),
    reload: (viewId: string) =>
      ipcRenderer.invoke('browserView:reload', viewId),
    openDevTools: (viewId: string) =>
      ipcRenderer.invoke('browserView:openDevTools', viewId),
    getCurrentURL: (viewId: string) =>
      ipcRenderer.invoke('browserView:getCurrentURL', viewId),
    canGoBack: (viewId: string) =>
      ipcRenderer.invoke('browserView:canGoBack', viewId),
    canGoForward: (viewId: string) =>
      ipcRenderer.invoke('browserView:canGoForward', viewId),
    // Listener registration for events from main to renderer
    onNavigationStateChanged: (viewId: string, callback: (state: {url: string, title: string, isLoading: boolean, canGoBack: boolean, canGoForward: boolean}) => void) => {
      const channel = `browserView:navigationStateChanged:${viewId}`;
      const handler = (_: Electron.IpcRendererEvent, state) => callback(state);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler); // Return a cleanup function
    },
    onTitleUpdated: (viewId: string, callback: (title: string) => void) => {
      const channel = `browserView:titleUpdated:${viewId}`;
      const handler = (_: Electron.IpcRendererEvent, title) => callback(title);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    onLoadFailed: (viewId: string, callback: (details: {url: string, error: string, code: number}) => void) => {
      const channel = `browserView:loadFailed:${viewId}`;
      const handler = (_: Electron.IpcRendererEvent, details) => callback(details);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  huggingFaceService: {
    listModels: (search?: string, author?: string, tags?: string[], limit?: number, full?: boolean) =>
      ipcRenderer.invoke('huggingFace:listModels', search, author, tags, limit, full),
    getModelInfo: (modelId: string) =>
      ipcRenderer.invoke('huggingFace:getModelInfo', modelId),
    getSpaceInfo: (spaceId: string) =>
      ipcRenderer.invoke('huggingFace:getSpaceInfo', spaceId),
    getSpaceUrl: (spaceId: string) => // This will return a Promise due to invoke
      ipcRenderer.invoke('huggingFace:getSpaceUrl', spaceId)
  },
  githubService: {
    getRepoInfo: (owner: string, repo: string) =>
      ipcRenderer.invoke('github:getRepoInfo', owner, repo),
    getRepoContents: (owner: string, repo: string, contentPath: string = '', ref?: string) =>
      ipcRenderer.invoke('github:getRepoContents', owner, repo, contentPath, ref),
    getFileContent: (owner: string, repo: string, filePath: string, ref?: string) =>
      ipcRenderer.invoke('github:getFileContent', owner, repo, filePath, ref),
    listUserRepos: (username: string, type?: 'all' | 'owner' | 'member', sort?: 'created' | 'updated' | 'pushed' | 'full_name', direction?: 'asc' | 'desc', perPage?: number, page?: number) =>
      ipcRenderer.invoke('github:listUserRepos', username, type, sort, direction, perPage, page)
  },
  agentEvents: { // New section for agent related events from main to renderer
    onActionStatusUpdate: (callback: (statusUpdate: { agentId: string; actionName: string; parameters: any; status: 'started' | 'completed' | 'error'; result?: any; error?: string; timestamp: string }) => void) => {
      const channel = 'agent-action-statusUpdate';
      const handler = (_event: Electron.IpcRendererEvent, statusUpdate: any) => {
        callback(statusUpdate);
      };
      ipcRenderer.on(channel, handler);
      // Return a cleanup function to remove the listener
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
