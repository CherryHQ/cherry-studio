import type { RouteDef } from '../define'
import { type AiEventSchemas, aiRequestSchemas } from './ai'
import { apiGatewayRequestSchemas } from './apiGateway'
import { type AppEventSchemas, appRequestSchemas } from './app'
import { type BinaryEventSchemas, binaryRequestSchemas } from './binary'
import { type ChannelEventSchemas, channelRequestSchemas } from './channel'
import { cherryinRequestSchemas } from './cherryin'
import { codeCliRequestSchemas } from './codeCli'
import { exportRequestSchemas } from './export'
import { fileRequestSchemas } from './file'
import { fileProcessingRequestSchemas } from './fileProcessing'
import { knowledgeRequestSchemas } from './knowledge'
import { type LocalModelEventSchemas, localModelRequestSchemas } from './localModel'
import { type McpEventSchemas, mcpRequestSchemas } from './mcp'
import { miniAppRequestSchemas } from './miniApp'
import { type NavigationEventSchemas, navigationRequestSchemas } from './navigation'
import { type NotificationEventSchemas, notificationRequestSchemas } from './notification'
import { type OAuthEventSchemas, oauthRequestSchemas } from './oauth'
import { openclawRequestSchemas } from './openclaw'
import { ovmsRequestSchemas } from './ovms'
import { printRequestSchemas } from './print'
import { profileRequestSchemas } from './profile'
import { providerRequestSchemas } from './provider'
import { type QuickAssistantEventSchemas, quickAssistantRequestSchemas } from './quickAssistant'
import { type SelectionEventSchemas, selectionRequestSchemas } from './selection'
import { skillRequestSchemas } from './skill'
import { type SystemEventSchemas, systemRequestSchemas } from './system'
import { type TabEventSchemas, tabRequestSchemas } from './tab'
import { translateRequestSchemas } from './translate'
import { webSearchRequestSchemas } from './webSearch'
import { type WebviewEventSchemas, webviewRequestSchemas } from './webview'
import { type WindowEventSchemas, windowRequestSchemas } from './window'

/**
 * Global request registry — the single source of truth the main router parses
 * against. Each migrated domain spreads its own `*RequestSchemas` object here.
 *
 * Renderer code MUST `import type` from this module so the zod schema *values*
 * never enter the renderer bundle (see ipc-overview.md, "zod across processes").
 */
export const ipcRequestSchemas = {
  ...aiRequestSchemas,
  ...apiGatewayRequestSchemas,
  ...appRequestSchemas,
  ...binaryRequestSchemas,
  ...channelRequestSchemas,
  ...cherryinRequestSchemas,
  ...codeCliRequestSchemas,
  ...exportRequestSchemas,
  ...fileRequestSchemas,
  ...fileProcessingRequestSchemas,
  ...knowledgeRequestSchemas,
  ...localModelRequestSchemas,
  ...mcpRequestSchemas,
  ...miniAppRequestSchemas,
  ...navigationRequestSchemas,
  ...notificationRequestSchemas,
  ...oauthRequestSchemas,
  ...openclawRequestSchemas,
  ...ovmsRequestSchemas,
  ...printRequestSchemas,
  ...profileRequestSchemas,
  ...providerRequestSchemas,
  ...quickAssistantRequestSchemas,
  ...selectionRequestSchemas,
  ...skillRequestSchemas,
  ...systemRequestSchemas,
  ...tabRequestSchemas,
  ...translateRequestSchemas,
  ...webSearchRequestSchemas,
  ...webviewRequestSchemas,
  ...windowRequestSchemas
} satisfies Record<string, RouteDef>

export type IpcRequestSchemas = typeof ipcRequestSchemas
/** Union of all declared request routes (`never` until a domain is migrated). */
export type IpcRoute = keyof IpcRequestSchemas

/**
 * Global event registry (pure types — main is the TCB that constructs events, so
 * the renderer trusts them and never re-parses). Each migrated domain intersects
 * its own `*EventSchemas` type here.
 */
export type IpcEventSchemas = AiEventSchemas &
  AppEventSchemas &
  BinaryEventSchemas &
  ChannelEventSchemas &
  LocalModelEventSchemas &
  McpEventSchemas &
  NavigationEventSchemas &
  NotificationEventSchemas &
  OAuthEventSchemas &
  QuickAssistantEventSchemas &
  SelectionEventSchemas &
  SystemEventSchemas &
  TabEventSchemas &
  WebviewEventSchemas &
  WindowEventSchemas
/** Union of all declared event names (`never` until a domain is migrated). */
export type IpcEventName = keyof IpcEventSchemas
