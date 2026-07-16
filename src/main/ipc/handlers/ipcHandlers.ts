import type { IpcRequestSchemas } from '@shared/ipc/schemas/ipcSchemas'
import type { IpcHandlersFor } from '@shared/ipc/types'

import { aiHandlers } from './ai'
import { apiGatewayHandlers } from './apiGateway'
import { appHandlers } from './app'
import { binaryHandlers } from './binary'
import { channelHandlers } from './channel'
import { cherryinHandlers } from './cherryin'
import { codeCliHandlers } from './codeCli'
import { exportHandlers } from './export'
import { fileHandlers } from './file'
import { fileProcessingHandlers } from './fileProcessing'
import { knowledgeHandlers } from './knowledge'
import { localModelHandlers } from './localModel'
import { mcpHandlers } from './mcp'
import { miniAppHandlers } from './miniApp'
import { navigationHandlers } from './navigation'
import { notificationHandlers } from './notification'
import { oauthHandlers } from './oauth'
import { openclawHandlers } from './openclaw'
import { ovmsHandlers } from './ovms'
import { printHandlers } from './print'
import { profileHandlers } from './profile'
import { providerHandlers } from './provider'
import { quickAssistantHandlers } from './quickAssistant'
import { selectionHandlers } from './selection'
import { skillHandlers } from './skill'
import { systemHandlers } from './system'
import { tabHandlers } from './tab'
import { translateHandlers } from './translate'
import { webSearchHandlers } from './webSearch'
import { webviewHandlers } from './webview'
import { windowHandlers } from './window'

/**
 * Global request handler map — exactly one handler per declared route, exhaustive
 * and closed (enforced by the `IpcHandlersFor<IpcRequestSchemas>` annotation:
 * miss a route → compile error; add an undeclared one → compile error).
 *
 * Each migrated domain spreads its own `*Handlers` object here. This is the single
 * place that enumerates every main capability the renderer can reach — the audited
 * exposure surface.
 */
export const ipcHandlers: IpcHandlersFor<IpcRequestSchemas> = {
  ...aiHandlers,
  ...apiGatewayHandlers,
  ...appHandlers,
  ...binaryHandlers,
  ...channelHandlers,
  ...cherryinHandlers,
  ...codeCliHandlers,
  ...exportHandlers,
  ...fileHandlers,
  ...fileProcessingHandlers,
  ...knowledgeHandlers,
  ...localModelHandlers,
  ...mcpHandlers,
  ...miniAppHandlers,
  ...navigationHandlers,
  ...notificationHandlers,
  ...oauthHandlers,
  ...openclawHandlers,
  ...ovmsHandlers,
  ...printHandlers,
  ...profileHandlers,
  ...providerHandlers,
  ...quickAssistantHandlers,
  ...selectionHandlers,
  ...skillHandlers,
  ...systemHandlers,
  ...tabHandlers,
  ...translateHandlers,
  ...webSearchHandlers,
  ...webviewHandlers,
  ...windowHandlers
}
