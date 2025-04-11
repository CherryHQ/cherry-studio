interface ObsidianAPI {
  getVaults: () => Promise<Array<{ path: string; name: string }>>
  getFiles: (vaultName: string) => Promise<Array<{ path: string; type: 'folder' | 'markdown'; name: string }>>
  getFolders: (vaultName: string) => Promise<Array<{ path: string; type: 'folder' | 'markdown'; name: string }>>
}

interface IpcRendererAPI {
  invoke: (channel: string, ...args: any[]) => Promise<any>
  on: (channel: string, listener: (...args: any[]) => void) => () => void
  once: (channel: string, listener: (...args: any[]) => void) => () => void
  removeListener: (channel: string, listener: (...args: any[]) => void) => void
  removeAllListeners: (channel: string) => void
  send: (channel: string, ...args: any[]) => void
  sendSync: (channel: string, ...args: any[]) => any
}

interface ElectronAPI {
  ipcRenderer: IpcRendererAPI
  process: {
    platform: string
  }
}

interface Window {
  obsidian: ObsidianAPI
  electron: ElectronAPI
}
