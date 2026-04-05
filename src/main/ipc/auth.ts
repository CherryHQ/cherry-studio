import { anthropicService } from '@main/services/AnthropicService'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { cherryINOAuthService } from '../services/CherryINOAuthService'
import { copilotService } from '../services/CopilotService'
import { vertexAIService } from '../services/VertexAIService'

export function registerAuthIpc() {
  // VertexAI
  ipcMain.handle(IpcChannel.VertexAI_GetAuthHeaders, async (_, params) => {
    return vertexAIService.getAuthHeaders(params)
  })

  ipcMain.handle(IpcChannel.VertexAI_GetAccessToken, async (_, params) => {
    return vertexAIService.getAccessToken(params)
  })

  ipcMain.handle(IpcChannel.VertexAI_ClearAuthCache, async (_, projectId: string, clientEmail?: string) => {
    vertexAIService.clearAuthCache(projectId, clientEmail)
  })

  // Copilot
  ipcMain.handle(IpcChannel.Copilot_GetAuthMessage, copilotService.getAuthMessage.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_GetCopilotToken, copilotService.getCopilotToken.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_SaveCopilotToken, copilotService.saveCopilotToken.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_GetToken, copilotService.getToken.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_Logout, copilotService.logout.bind(copilotService))
  ipcMain.handle(IpcChannel.Copilot_GetUser, copilotService.getUser.bind(copilotService))

  // CherryIN OAuth
  ipcMain.handle(IpcChannel.CherryIN_SaveToken, cherryINOAuthService.saveToken.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_HasToken, cherryINOAuthService.hasToken.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_GetBalance, cherryINOAuthService.getBalance.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_Logout, cherryINOAuthService.logout.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_StartOAuthFlow, cherryINOAuthService.startOAuthFlow.bind(cherryINOAuthService))
  ipcMain.handle(IpcChannel.CherryIN_ExchangeToken, cherryINOAuthService.exchangeToken.bind(cherryINOAuthService))

  // Anthropic OAuth
  ipcMain.handle(IpcChannel.Anthropic_StartOAuthFlow, () => anthropicService.startOAuthFlow())
  ipcMain.handle(IpcChannel.Anthropic_CompleteOAuthWithCode, (_, code: string) =>
    anthropicService.completeOAuthWithCode(code)
  )
  ipcMain.handle(IpcChannel.Anthropic_CancelOAuthFlow, () => anthropicService.cancelOAuthFlow())
  ipcMain.handle(IpcChannel.Anthropic_GetAccessToken, () => anthropicService.getValidAccessToken())
  ipcMain.handle(IpcChannel.Anthropic_HasCredentials, () => anthropicService.hasCredentials())
  ipcMain.handle(IpcChannel.Anthropic_ClearCredentials, () => anthropicService.clearCredentials())
}
