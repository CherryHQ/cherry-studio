/**
 * `miniapp-browser` tool — the AI-SDK wrapper over the `miniappBrowser` core.
 * Session identity comes from the request's `topicId`, never from model input.
 */

import { tool } from 'ai'

import {
  MINIAPP_BROWSER_DESCRIPTION,
  MINIAPP_BROWSER_TOOL_NAME,
  miniappBrowserInputSchema,
  miniappBrowserOutputSchema,
  runMiniappBrowser
} from '../../../miniappBrowser'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { MINIAPP_BROWSER_TOOL_NAME }

const miniappBrowserTool = tool({
  description: MINIAPP_BROWSER_DESCRIPTION,
  inputSchema: miniappBrowserInputSchema,
  outputSchema: miniappBrowserOutputSchema,
  execute: async (input, options) => {
    const { request } = getToolCallContext(options)
    return runMiniappBrowser(input, { sessionId: request.topicId })
  }
})

export function createMiniappBrowserToolEntry(): ToolEntry {
  return {
    name: MINIAPP_BROWSER_TOOL_NAME,
    namespace: 'miniapp',
    description: 'Operate the bound Mini App preview page (snapshot, click, type, wait, logs, screenshot)',
    defer: 'never',
    tool: miniappBrowserTool
  }
}
