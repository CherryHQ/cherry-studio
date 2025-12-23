export { closeTabToolDefinition, handleCloseTab } from './closeTab'
export { createTabToolDefinition, handleCreateTab } from './createTab'
export { ExecuteSchema, executeToolDefinition, handleExecute } from './execute'
export { FetchSchema, fetchToolDefinition, handleFetch } from './fetch'
export { handleListTabs, listTabsToolDefinition } from './listTabs'
export { handleOpen, OpenSchema, openToolDefinition } from './open'
export { handleReset, resetToolDefinition } from './reset'
export { handleSwitchTab, switchTabToolDefinition } from './switchTab'

import type { CdpBrowserController } from '../controller'
import { closeTabToolDefinition, handleCloseTab } from './closeTab'
import { createTabToolDefinition, handleCreateTab } from './createTab'
import { executeToolDefinition, handleExecute } from './execute'
import { fetchToolDefinition, handleFetch } from './fetch'
import { handleListTabs, listTabsToolDefinition } from './listTabs'
import { handleOpen, openToolDefinition } from './open'
import { handleReset, resetToolDefinition } from './reset'
import { handleSwitchTab, switchTabToolDefinition } from './switchTab'

export const toolDefinitions = [
  openToolDefinition,
  executeToolDefinition,
  resetToolDefinition,
  fetchToolDefinition,
  createTabToolDefinition,
  listTabsToolDefinition,
  closeTabToolDefinition,
  switchTabToolDefinition
]

export const toolHandlers: Record<
  string,
  (
    controller: CdpBrowserController,
    args: unknown
  ) => Promise<{ content: { type: string; text: string }[]; isError: boolean }>
> = {
  open: handleOpen,
  execute: handleExecute,
  reset: handleReset,
  fetch: handleFetch,
  create_tab: handleCreateTab,
  list_tabs: handleListTabs,
  close_tab: handleCloseTab,
  switch_tab: handleSwitchTab
}
