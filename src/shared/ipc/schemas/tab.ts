import * as z from 'zod'

import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ConversationType } from '@shared/types/navigation'

import { defineRoute } from '../define'

/** A conversation's new title, identified by the shared conversation vocabulary. */
export interface ConversationTitlePayload {
  conversationType: ConversationType
  conversationId: string
  title: string
}

/**
 * Tab (detached sub-window) IPC schemas. The legacy `tab:attach` string served both an
 * R→M invoke and an M→R broadcast; it is split into `tab.attach` (request; the caller only
 * fires it, so it is void) and `tab.attached` (event, the Tab to re-attach into the main
 * window). `tab.detach` / `tab.drag_end` were fire-and-forget `ipcOn`s → void requests.
 * Tab_MoveWindow stays on legacy native IPC (per-frame R→M escape hatch, see docs).
 */
export const tabRequestSchemas = {
  'tab.attach': defineRoute({ input: z.custom<Tab>(), output: z.void() }),
  'tab.detach': defineRoute({
    // Mirrors SubWindowService.createWindow's tab identity, URL, presentation, and optional
    // drag-drop position; extra Tab fields are stripped by the object schema.
    input: z.object({
      id: z.string(),
      url: z.string(),
      title: z.string().optional(),
      icon: z.string().optional(),
      type: z.string().optional(),
      isPinned: z.boolean().optional(),
      x: z.number().optional(),
      y: z.number().optional()
    }),
    output: z.void()
  }),
  'tab.drag_end': defineRoute({ input: z.void(), output: z.void() }),
  // A window renamed a conversation and asks main to relay the new title: another window's
  // tab for it may be dormant or hidden, with no page left that could derive the name.
  'tab.sync_conversation_title': defineRoute({
    input: z.object({
      conversationType: z.enum(['assistant', 'agent']),
      conversationId: z.string(),
      title: z.string()
    }),
    output: z.void()
  })
}

export type TabEventSchemas = {
  'tab.attached': Tab
  'tab.conversation_title_synced': ConversationTitlePayload
}
