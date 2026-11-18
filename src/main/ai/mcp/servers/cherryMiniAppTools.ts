/**
 * Mini App authoring tools (`mini_app` / `miniapp-browser`) hosted by the in-process
 * `cherry-tools` MCP server (see `cherryBuiltinTools.ts`), so agent runtimes (Claude
 * Code, Pi) can author and drive previews exactly like the AI-SDK builtin path.
 *
 * This provider only ADAPTS: both tools wrap the same runtime-agnostic cores the
 * AI-SDK wrappers use (`runMiniAppAuthoring`, `runMiniappBrowser`), and the session
 * identity comes from the connection options the host built — never from model
 * input — so a prompt cannot talk its way into another session's previews or
 * workspace paths. `install` and `pin` stay absent here for the same reason they
 * are absent on the AI-SDK path: installation consent is the renderer's
 * consent-card flow, and an action that does not exist is the strongest form of
 * "automation cannot approve installation consent" (AC6).
 *
 * Browser automation needs the preview's live guest, which only exists while a
 * preview pane has the page mounted — agent sessions get that surface from the
 * agents page right pane (`mini-app-previews` capability), the same component the
 * home topics pane uses.
 */

import type { McpServer } from '@modelcontextprotocol/server'

import { loggerService } from '@logger'
import { modelOutputToMcpResult } from '@main/ai/mcp/toolResult'
import {
  MINI_APP_DESCRIPTION,
  MINI_APP_TOOL_NAME,
  miniAppAuthoringInputSchema,
  runMiniAppAuthoring
} from '@main/ai/tools/miniAppAuthoring'
import {
  MINIAPP_BROWSER_DESCRIPTION,
  MINIAPP_BROWSER_TOOL_NAME,
  miniappBrowserInputSchema,
  runMiniappBrowser
} from '@main/ai/tools/miniappBrowser'

const logger = loggerService.withContext('McpServer:CherryMiniAppTools')

export interface MiniAppToolsContext {
  /** The agent session that owns previews and artifact tokens for this connection. */
  sessionId: string
  /** Workspace roots `validate` may read; the host derives them from the session record. */
  roots: ReadonlyArray<{ uri: string; name?: string }>
}

export function registerMiniAppTools(server: McpServer, { sessionId, roots }: MiniAppToolsContext): void {
  server.registerTool(
    MINI_APP_TOOL_NAME,
    { description: MINI_APP_DESCRIPTION, inputSchema: miniAppAuthoringInputSchema },
    async (input) => {
      const output = await runMiniAppAuthoring(input, { sessionId, roots })
      if ('error' in output) {
        logger.warn('mini_app call refused', { sessionId, action: input.action, code: output.code })
      }
      return modelOutputToMcpResult({ type: 'json', value: output })
    }
  )
  server.registerTool(
    MINIAPP_BROWSER_TOOL_NAME,
    { description: MINIAPP_BROWSER_DESCRIPTION, inputSchema: miniappBrowserInputSchema },
    async (input) => {
      const output = await runMiniappBrowser(input, { sessionId })
      if ('error' in output) {
        logger.warn('miniapp-browser call refused', { sessionId, action: input.action, code: output.code })
      }
      return modelOutputToMcpResult({ type: 'json', value: output })
    }
  )
}
