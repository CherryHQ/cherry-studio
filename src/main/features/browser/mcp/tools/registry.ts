import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { BrowserController } from '../browserController'
import { handleDialog } from './dialog'
import { handleExecute } from './execute'
import { handleConsoleMessages, handleFind, handleNetworkRequests } from './inspect'
import { handleInteraction } from './interact'
import { handleHistory, handleWaitFor } from './navigate'
import { handleOpen } from './open'
import { handleReset } from './reset'
import { handleScreenshot } from './screenshot'
import { handleSnapshot } from './snapshot'
import { handleCloseTab, handleListTabs, handleSwitchTab } from './tabs'
import { handleListWebTools, handleCallWebTool } from './webMcp'

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
