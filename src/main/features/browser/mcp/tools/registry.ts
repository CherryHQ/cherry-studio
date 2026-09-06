import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { CdpBrowserController } from '../controller'
import { dialogToolDefinition, handleDialog } from './dialog'
import { executeToolDefinition, handleExecute } from './execute'
import { handleInteraction, interactionToolDefinitions } from './interact'
import { handleHistory, handleWaitFor, navigateToolDefinitions } from './navigate'
import { handleOpen, openToolDefinition } from './open'
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
  ...navigateToolDefinitions
]

export const toolHandlers: Record<
  string,
  (controller: CdpBrowserController, args: unknown, signal?: AbortSignal) => Promise<CallToolResult>
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
  wait_for: handleWaitFor
}
