import { IpcChannel } from '@shared/IpcChannel'
import { ipcRenderer } from 'electron'

export const authApi = {
  copilot: {
    getAuthMessage: (headers?: Record<string, string>) =>
      ipcRenderer.invoke(IpcChannel.Copilot_GetAuthMessage, headers),
    getCopilotToken: (device_code: string, headers?: Record<string, string>) =>
      ipcRenderer.invoke(IpcChannel.Copilot_GetCopilotToken, device_code, headers),
    saveCopilotToken: (access_token: string) => ipcRenderer.invoke(IpcChannel.Copilot_SaveCopilotToken, access_token),
    getToken: (headers?: Record<string, string>) => ipcRenderer.invoke(IpcChannel.Copilot_GetToken, headers),
    logout: () => ipcRenderer.invoke(IpcChannel.Copilot_Logout),
    getUser: (token: string) => ipcRenderer.invoke(IpcChannel.Copilot_GetUser, token)
  },
  cherryin: {
    saveToken: (accessToken: string, refreshToken?: string) =>
      ipcRenderer.invoke(IpcChannel.CherryIN_SaveToken, accessToken, refreshToken),
    hasToken: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.CherryIN_HasToken),
    getBalance: (apiHost: string) => ipcRenderer.invoke(IpcChannel.CherryIN_GetBalance, apiHost),
    logout: (apiHost: string) => ipcRenderer.invoke(IpcChannel.CherryIN_Logout, apiHost),
    startOAuthFlow: (oauthServer: string, apiHost?: string) =>
      ipcRenderer.invoke(IpcChannel.CherryIN_StartOAuthFlow, oauthServer, apiHost),
    exchangeToken: (code: string, state: string) => ipcRenderer.invoke(IpcChannel.CherryIN_ExchangeToken, code, state)
  },
  anthropic_oauth: {
    startOAuthFlow: () => ipcRenderer.invoke(IpcChannel.Anthropic_StartOAuthFlow),
    completeOAuthWithCode: (code: string) => ipcRenderer.invoke(IpcChannel.Anthropic_CompleteOAuthWithCode, code),
    cancelOAuthFlow: () => ipcRenderer.invoke(IpcChannel.Anthropic_CancelOAuthFlow),
    getAccessToken: () => ipcRenderer.invoke(IpcChannel.Anthropic_GetAccessToken),
    hasCredentials: () => ipcRenderer.invoke(IpcChannel.Anthropic_HasCredentials),
    clearCredentials: () => ipcRenderer.invoke(IpcChannel.Anthropic_ClearCredentials)
  },
  vertexAI: {
    getAuthHeaders: (params: { projectId: string; serviceAccount?: { privateKey: string; clientEmail: string } }) =>
      ipcRenderer.invoke(IpcChannel.VertexAI_GetAuthHeaders, params),
    getAccessToken: (params: { projectId: string; serviceAccount?: { privateKey: string; clientEmail: string } }) =>
      ipcRenderer.invoke(IpcChannel.VertexAI_GetAccessToken, params),
    clearAuthCache: (projectId: string, clientEmail?: string) =>
      ipcRenderer.invoke(IpcChannel.VertexAI_ClearAuthCache, projectId, clientEmail)
  }
}
