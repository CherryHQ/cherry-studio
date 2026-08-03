import type { ConversationNavigationTarget } from '@shared/types/navigation'
import * as z from 'zod'

import { defineRoute } from '../define'

const conversationNavigationTargetSchema = z.object({
  conversationType: z.enum(['assistant', 'agent']),
  conversationId: z.string().min(1)
})

/**
 * Navigation IPC schemas — route or focus existing application content.
 *
 * SCOPE GUARD: this domain is strictly "navigate-to". Route requests take the
 * running main window to a path. Conversation requests ask full-chrome tab owners
 * for their current state, then focus one owner or open in one selected window.
 * It is NOT "spawn-with": creating a NEW window around content (subWindow tab
 * detach, selection popups, …) takes a full payload and belongs to that window's
 * own service — e.g. SubWindowService for subWindows.
 *
 * Two blocks per the framework's two-axis model (see ipc-overview.md):
 *   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
 *   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
 */

// ── Request: renderer→main calls (zod values, always parsed) ──
export const navigationRequestSchemas = {
  // Open an allowlisted route in the main window, from ANY window (the caller is
  // usually not the main window — hence the `_in_main` target qualifier). Paths
  // outside ALLOWED_ROUTE_PREFIXES (mainWindowNavigation.ts) are warn-and-dropped.
  'navigation.open_route_in_main': defineRoute({
    input: z.object({
      path: z.string()
    }),
    output: z.void()
  }),
  // Main serializes this operation per conversation and chooses one full-chrome
  // destination after the on-demand ownership responses below.
  'navigation.focus_or_open_conversation': defineRoute({
    input: z.object({
      target: conversationNavigationTargetSchema,
      title: z.string()
    }),
    output: z.void()
  }),
  // Renderer replies use IpcContext.senderId as the trusted owner identity; no
  // window id is accepted from the payload. The same requestId is reported once
  // for the ownership snapshot and again after a selected renderer has committed
  // the requested focus/open, keeping main's per-conversation lock alive until then.
  'navigation.report_conversation_ownership': defineRoute({
    input: z.object({
      requestId: z.string().min(1),
      ownsTarget: z.boolean()
    }),
    output: z.void()
  })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type NavigationEventSchemas = {
  // Sent *directed* to the main window only: a route open was requested (deep
  // link, another window, app menu). The main-window shell decides how to land
  // it (settings singleton tab vs regular openTab). Fact-style name on purpose —
  // events report what happened; requests give orders.
  'navigation.open_route_requested': { to: string }
  // Directed to each live full-chrome TabsProvider for an event-time snapshot.
  'navigation.conversation_ownership_requested': {
    requestId: string
    target: ConversationNavigationTarget
  }
  // Directed to exactly one selected owner/destination. The renderer confirms the
  // committed result through `navigation.report_conversation_ownership` above.
  'navigation.conversation_focus_or_open_requested': {
    requestId: string
    target: ConversationNavigationTarget
    title: string
  }
  // Broadcast fall-through for a deep link whose host matched no dedicated handler
  // (e.g. the PPIO OAuth callback, which has an empty host). Carries the raw url + query
  // params; each consumer filters for what it expects. Broadcast, unlike the directed
  // open_route_requested above.
  'navigation.protocol_data': { url: string; params: Record<string, string> }
}
