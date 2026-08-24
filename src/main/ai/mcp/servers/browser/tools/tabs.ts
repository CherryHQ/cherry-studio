import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

// --- list_tabs ---

export const ListTabsSchema = z.object({
  privateMode: z.boolean().optional().describe('List tabs from private window (default: false)')
})

export const listTabsToolDefinition = {
  name: 'list_tabs',
  description: 'List all open tabs with their IDs, URLs, and titles. Use to see what pages are currently open.',
  inputSchema: {
    type: 'object',
    properties: {
      privateMode: {
        type: 'boolean',
        description: 'List tabs from private window (default: false)'
      }
    }
  }
}

export async function handleListTabs(controller: CdpBrowserController, args: unknown) {
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

export const SwitchTabSchema = z.object({
  tabId: z.string().describe('Tab ID to switch to'),
  privateMode: z.boolean().optional().describe('Target private window (default: false)')
})

export const switchTabToolDefinition = {
  name: 'switch_tab',
  description: 'Switch to a specific tab by its ID. Use after list_tabs to activate a different tab.',
  inputSchema: {
    type: 'object',
    properties: {
      tabId: {
        type: 'string',
        description: 'Tab ID to switch to (from list_tabs or open response)'
      },
      privateMode: {
        type: 'boolean',
        description: 'Target private window (default: false)'
      }
    },
    required: ['tabId']
  }
}

export async function handleSwitchTab(controller: CdpBrowserController, args: unknown) {
  try {
    const { tabId, privateMode } = SwitchTabSchema.parse(args)
    await controller.switchTab(privateMode ?? false, tabId)
    return successResponse(JSON.stringify({ switched: tabId }))
  } catch (error) {
    logger.error('Switch tab failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}

// --- close_tab ---

export const CloseTabSchema = z.object({
  tabId: z.string().describe('Tab ID to close'),
  privateMode: z.boolean().optional().describe('Target private window (default: false)')
})

export const closeTabToolDefinition = {
  name: 'close_tab',
  description: 'Close a specific tab by its ID. Use to free resources when done with a page.',
  inputSchema: {
    type: 'object',
    properties: {
      tabId: {
        type: 'string',
        description: 'Tab ID to close (from list_tabs or open response)'
      },
      privateMode: {
        type: 'boolean',
        description: 'Target private window (default: false)'
      }
    },
    required: ['tabId']
  }
}

export async function handleCloseTab(controller: CdpBrowserController, args: unknown) {
  try {
    const { tabId, privateMode } = CloseTabSchema.parse(args)
    await controller.closeTab(privateMode ?? false, tabId)
    return successResponse(JSON.stringify({ closed: tabId }))
  } catch (error) {
    logger.error('Close tab failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
