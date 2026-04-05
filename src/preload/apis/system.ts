import type { GitBashPathInfo } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcRenderer } from 'electron'

export const systemApi = {
  system: {
    getDeviceType: () => ipcRenderer.invoke(IpcChannel.System_GetDeviceType),
    getHostname: () => ipcRenderer.invoke(IpcChannel.System_GetHostname),
    getCpuName: () => ipcRenderer.invoke(IpcChannel.System_GetCpuName),
    checkGitBash: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.System_CheckGitBash),
    getGitBashPath: (): Promise<string | null> => ipcRenderer.invoke(IpcChannel.System_GetGitBashPath),
    getGitBashPathInfo: (): Promise<GitBashPathInfo> => ipcRenderer.invoke(IpcChannel.System_GetGitBashPathInfo),
    setGitBashPath: (newPath: string | null): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.System_SetGitBashPath, newPath)
  },
  devTools: {
    toggle: () => ipcRenderer.invoke(IpcChannel.System_ToggleDevTools)
  }
}
