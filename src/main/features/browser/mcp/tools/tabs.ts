import { ListTabsSchema, SwitchTabSchema, CloseTabSchema } from '@main/ai/mcp/browserToolDefinitions'

import { BrowserSessionError } from '../../session/BrowserSessionError'
import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

// --- list_tabs ---

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool registry dispatch erases tool-specific inputs; ListTabsSchema establishes the private-mode selection before listing controller tabs.
export async function handleListTabs(controller: BrowserController, args: unknown) {
  try {
    const { privateMode } = ListTabsSchema.parse(args)
    const tabs = await controller.listTabs(privateMode ?? false)
    return successResponse(JSON.stringify(tabs))
  } catch (error) {
    logger.error('List tabs failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}

// --- switch_tab ---

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The registry passes opaque per-tool arguments; SwitchTabSchema requires the tab identity and checks mode before changing selection.
export async function handleSwitchTab(controller: BrowserController, args: unknown) {
  try {
    const { tabId, privateMode } = SwitchTabSchema.parse(args)
    if (!controller.switchTab) throw new BrowserSessionError('not_allowed')
    await controller.switchTab(privateMode ?? false, tabId)
    return successResponse(JSON.stringify({ switched: tabId }))
  } catch (error) {
    logger.error('Switch tab failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}

// --- close_tab ---

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The heterogeneous registry cannot prove a close target; CloseTabSchema validates tab identity and mode before controller disposal.
export async function handleCloseTab(controller: BrowserController, args: unknown) {
  try {
    const { tabId, privateMode } = CloseTabSchema.parse(args)
    if (!controller.closeTab) throw new BrowserSessionError('not_allowed')
    await controller.closeTab(privateMode ?? false, tabId)
    return successResponse(JSON.stringify({ closed: tabId }))
  } catch (error) {
    logger.error('Close tab failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
