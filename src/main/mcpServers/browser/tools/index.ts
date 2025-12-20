export { ExecuteSchema, executeToolDefinition, handleExecute } from './execute'
export { FetchSchema, fetchToolDefinition, handleFetch } from './fetch'
export { handleOpen, OpenSchema, openToolDefinition } from './open'
export { handleReset, resetToolDefinition } from './reset'
export { createTabToolDefinition, handleCreateTab } from './createTab'
export { listTabsToolDefinition, handleListTabs } from './listTabs'
export { closeTabToolDefinition, handleCloseTab } from './closeTab'
export { switchTabToolDefinition, handleSwitchTab } from './switchTab'

import type { CdpBrowserController } from '../controller'
import { executeToolDefinition, handleExecute } from './execute'
import { fetchToolDefinition, handleFetch } from './fetch'
import { handleOpen, openToolDefinition } from './open'
import { handleReset, resetToolDefinition } from './reset'
import { createTabToolDefinition, handleCreateTab } from './createTab'
import { listTabsToolDefinition, handleListTabs } from './listTabs'
import { closeTabToolDefinition, handleCloseTab } from './closeTab'
import { switchTabToolDefinition, handleSwitchTab } from './switchTab'

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
