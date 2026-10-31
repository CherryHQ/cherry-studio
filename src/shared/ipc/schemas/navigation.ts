import * as z from 'zod'

import { ComposerMessageTokenKindSchema } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema, FileTypeSchema } from '@shared/types/file'
import type { ConversationDraft, ConversationNavigationTarget } from '@shared/types/navigation'

import { defineRoute } from '../define'

/**
 * Runtime form of {@link ConversationNavigationTarget}. The `z.ZodType<…>` annotation binds the
 * two structurally, so adding a field to the type without adding it here — which would silently
 * strip it on the request leg while the event leg carries it — is a compile error (repo
 * convention — see selection.ts / webSearch.ts).
 */
const conversationNavigationTargetSchema: z.ZodType<ConversationNavigationTarget> = z.object({
  conversationType: z.enum(['assistant', 'agent']),
  conversationId: z.string().min(1)
})

const conversationDraftSchema: z.ZodType<ConversationDraft> = z.object({
  text: z.string(),
  tokens: z.array(
    z.object({
      id: z.string(),
      kind: z.union([ComposerMessageTokenKindSchema, z.enum(['promptVariable', 'messagePart'])]),
      label: z.string(),
      icon: z.string().optional(),
      description: z.string().optional(),
      promptText: z.string().optional(),
      payload: z.unknown().optional(),
      index: z.number(),
      textOffset: z.number()
    })
  ),
  files: z.array(
    z.object({
      fileTokenSourceId: z.string(),
      path: AbsoluteFilePathSchema.optional(),
      bytes: z.instanceof(Uint8Array).optional(),
      mimeType: z.string().optional(),
      name: z.string(),
      origin_name: z.string(),
      ext: z.string(),
      size: z.number(),
      type: FileTypeSchema,
      composerFileKind: z.literal('pasted-text').optional()
    })
  ),
  knowledgeBaseIds: z.array(z.string())
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
  'navigation.protocol_dispatch_ready': defineRoute({
    input: z.void(),
    output: z.void()
  }),
  'navigation.ack_open_route': defineRoute({
    input: z.object({
      requestId: z.number().int().nonnegative()
    }),
    output: z.void()
  }),
  // Main serializes this operation per conversation and chooses one full-chrome
  // destination after the on-demand ownership responses below. `draft` lands in
  // that destination's composer for the conversation.
  'navigation.focus_or_open_conversation': defineRoute({
    input: z.object({
      target: conversationNavigationTargetSchema,
      title: z.string(),
      draft: conversationDraftSchema.optional()
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
    draft?: ConversationDraft
  }
  // Broadcast fall-through for a deep link whose host matched no dedicated handler
  // (e.g. the PPIO OAuth callback, which has an empty host). Carries the raw url + query
  // params; each consumer filters for what it expects. Broadcast, unlike the directed
  // open_route_requested above.
  'navigation.protocol_data': { url: string; params: Record<string, string> }
}
