import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { BROWSER_TOOL_NAMES } from '@main/ai/mcp/browserTools'

import type { BrowserController } from '../browserController'
import { dialogToolDefinition, handleDialog } from './dialog'
import { executeToolDefinition, handleExecute } from './execute'
import { handleConsoleMessages, handleFind, handleNetworkRequests, inspectToolDefinitions } from './inspect'
import { handleInteraction, interactionToolDefinitions } from './interact'
import { handleHistory, handleWaitFor, navigateToolDefinitions } from './navigate'
import { handleOpen, openToolDefinition, OpenSchema } from './open'
import { handleReset, resetToolDefinition } from './reset'
import { handleScreenshot, screenshotToolDefinition } from './screenshot'
import { handleSnapshot, snapshotToolDefinition } from './snapshot'
import {
  closeTabToolDefinition,
  handleCloseTab,
  handleListTabs,
  handleSwitchTab,
  listTabsToolDefinition,
  switchTabToolDefinition
} from './tabs'
import { handleListWebTools, handleCallWebTool, webMcpToolDefinitions } from './webMcp'

export const toolDefinitions = [
  openToolDefinition,
  executeToolDefinition,
  screenshotToolDefinition,
  snapshotToolDefinition,
  listTabsToolDefinition,
  switchTabToolDefinition,
  closeTabToolDefinition,
  resetToolDefinition,
  dialogToolDefinition,
  ...interactionToolDefinitions,
  ...inspectToolDefinitions,
  ...webMcpToolDefinitions,
  ...navigateToolDefinitions
]

export const sessionToolDefinitions = toolDefinitions
  .filter(({ name }) => BROWSER_TOOL_NAMES.some((known) => known === name))
  .map((definition) =>
    definition.name === 'open'
      ? {
          ...definition,
          description:
            'Navigate this conversation browser pane. The user sees the same page. New tabs and private windows are unavailable.',
          inputSchema: OpenSchema.omit({ showWindow: true }).extend({
            privateMode: OpenSchema.shape.privateMode.describe('Unsupported by this host; must be false.'),
            newTab: OpenSchema.shape.newTab.describe('Unsupported by this host; must be false.')
          })
        }
      : definition
  )

export const toolHandlers: Record<
  string,
  (controller: BrowserController, args: unknown, signal?: AbortSignal) => Promise<CallToolResult>
> = {
  open: handleOpen,
  execute: handleExecute,
  screenshot: handleScreenshot,
  snapshot: handleSnapshot,
  list_tabs: handleListTabs,
  switch_tab: handleSwitchTab,
  close_tab: handleCloseTab,
  reset: handleReset,
  handle_dialog: handleDialog,
  click: (c, a, s) => handleInteraction('click', c, a, s),
  hover: (c, a, s) => handleInteraction('hover', c, a, s),
  scroll: (c, a, s) => handleInteraction('scroll', c, a, s),
  type: (c, a, s) => handleInteraction('type', c, a, s),
  press_key: (c, a, s) => handleInteraction('press_key', c, a, s),
  select_option: (c, a, s) => handleInteraction('select_option', c, a, s),
  go_back: (c, a, s) => handleHistory(c, a, -1, s),
  go_forward: (c, a, s) => handleHistory(c, a, 1, s),
  wait_for: handleWaitFor,
  find: handleFind,
  list_web_tools: handleListWebTools,
  call_web_tool: handleCallWebTool,
  console_messages: handleConsoleMessages,
  network_requests: handleNetworkRequests
}
