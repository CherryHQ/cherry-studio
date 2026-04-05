import type { TerminalConfig } from '@shared/config/constant'
import type { CodeToolsRunResult, OperationResult } from '@shared/config/types'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { Model, OcrProvider, OcrResult, Provider, SupportedOcrFile } from '@types'
import { ipcRenderer } from 'electron'

// OpenClaw types
export type OpenClawGatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface OpenClawHealthInfo {
  status: 'healthy' | 'unhealthy'
  gatewayPort: number
}

export interface OpenClawChannelInfo {
  id: string
  name: string
  type: string
  status: 'connected' | 'disconnected' | 'error'
}

export const integrationsApi = {
  obsidian: {
    getVaults: () => ipcRenderer.invoke(IpcChannel.Obsidian_GetVaults),
    getFolders: (vaultName: string) => ipcRenderer.invoke(IpcChannel.Obsidian_GetFiles, vaultName),
    getFiles: (vaultName: string) => ipcRenderer.invoke(IpcChannel.Obsidian_GetFiles, vaultName)
  },
  nutstore: {
    getSSOUrl: () => ipcRenderer.invoke(IpcChannel.Nutstore_GetSsoUrl),
    decryptToken: (token: string) => ipcRenderer.invoke(IpcChannel.Nutstore_DecryptToken, token),
    getDirectoryContents: (token: string, path: string) =>
      ipcRenderer.invoke(IpcChannel.Nutstore_GetDirectoryContents, token, path)
  },
  externalApps: {
    detectInstalled: (): Promise<ExternalAppInfo[]> => ipcRenderer.invoke(IpcChannel.ExternalApps_DetectInstalled)
  },
  ovms: {
    isSupported: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.Ovms_IsSupported),
    addModel: (modelName: string, modelId: string, modelSource: string, task: string) =>
      ipcRenderer.invoke(IpcChannel.Ovms_AddModel, modelName, modelId, modelSource, task),
    stopAddModel: () => ipcRenderer.invoke(IpcChannel.Ovms_StopAddModel),
    getModels: () => ipcRenderer.invoke(IpcChannel.Ovms_GetModels),
    isRunning: () => ipcRenderer.invoke(IpcChannel.Ovms_IsRunning),
    getStatus: () => ipcRenderer.invoke(IpcChannel.Ovms_GetStatus),
    runOvms: () => ipcRenderer.invoke(IpcChannel.Ovms_RunOVMS),
    stopOvms: () => ipcRenderer.invoke(IpcChannel.Ovms_StopOVMS)
  },
  cherryai: {
    generateSignature: (params: { method: string; path: string; query: string; body: Record<string, any> }) =>
      ipcRenderer.invoke(IpcChannel.Cherryai_GetSignature, params)
  },
  openclaw: {
    checkInstalled: (): Promise<{
      installed: boolean
      path: string | null
      needsMigration: boolean
    }> => ipcRenderer.invoke(IpcChannel.OpenClaw_CheckInstalled),
    install: (): Promise<OperationResult> => ipcRenderer.invoke(IpcChannel.OpenClaw_Install),
    uninstall: (): Promise<OperationResult> => ipcRenderer.invoke(IpcChannel.OpenClaw_Uninstall),
    startGateway: (port?: number): Promise<OperationResult> =>
      ipcRenderer.invoke(IpcChannel.OpenClaw_StartGateway, port),
    stopGateway: (): Promise<OperationResult> => ipcRenderer.invoke(IpcChannel.OpenClaw_StopGateway),
    getStatus: (): Promise<{ status: OpenClawGatewayStatus; port: number }> =>
      ipcRenderer.invoke(IpcChannel.OpenClaw_GetStatus),
    checkHealth: (): Promise<OpenClawHealthInfo> => ipcRenderer.invoke(IpcChannel.OpenClaw_CheckHealth),
    getDashboardUrl: (): Promise<string> => ipcRenderer.invoke(IpcChannel.OpenClaw_GetDashboardUrl),
    syncConfig: (provider: Provider, primaryModel: Model): Promise<OperationResult> =>
      ipcRenderer.invoke(IpcChannel.OpenClaw_SyncConfig, provider, primaryModel),
    getChannels: (): Promise<OpenClawChannelInfo[]> => ipcRenderer.invoke(IpcChannel.OpenClaw_GetChannels),
    checkUpdate: (): Promise<{
      hasUpdate: boolean
      currentVersion: string | null
      latestVersion: string | null
      message?: string
    }> => ipcRenderer.invoke(IpcChannel.OpenClaw_CheckUpdate),
    performUpdate: (): Promise<OperationResult> => ipcRenderer.invoke(IpcChannel.OpenClaw_PerformUpdate)
  },
  python: {
    execute: (script: string, context?: Record<string, any>, timeout?: number) =>
      ipcRenderer.invoke(IpcChannel.Python_Execute, script, context, timeout)
  },
  ocr: {
    ocr: (file: SupportedOcrFile, provider: OcrProvider): Promise<OcrResult> =>
      ipcRenderer.invoke(IpcChannel.OCR_ocr, file, provider),
    listProviders: (): Promise<string[]> => ipcRenderer.invoke(IpcChannel.OCR_ListProviders)
  },
  codeCli: {
    run: (
      cliTool: string,
      model: string,
      directory: string,
      env: Record<string, string>,
      options?: { autoUpdateToLatest?: boolean; terminal?: string }
    ): Promise<CodeToolsRunResult> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_Run, cliTool, model, directory, env, options),
    getAvailableTerminals: (): Promise<TerminalConfig[]> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_GetAvailableTerminals),
    setCustomTerminalPath: (terminalId: string, path: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_SetCustomTerminalPath, terminalId, path),
    getCustomTerminalPath: (terminalId: string): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_GetCustomTerminalPath, terminalId),
    removeCustomTerminalPath: (terminalId: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_RemoveCustomTerminalPath, terminalId)
  }
}
