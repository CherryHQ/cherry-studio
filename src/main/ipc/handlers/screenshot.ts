import { application } from '@application'
import type { screenshotRequestSchemas } from '@shared/ipc/schemas/screenshot'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters onto `ScreenshotOverlayService`; all session state and window
 * choreography stay in that service.
 *
 * Authorization is two-tiered. `validateSender` only proves the caller is one of our
 * own renderers — every window (main, quick assistant, a MiniApp's host) passes it.
 * On top of that:
 *
 * - **Session scope** (`isSessionOverlay`) — the caller must be an overlay of the live
 *   capture session. Used by `overlay_active`, which is precisely the call that CHANGES
 *   which overlay is active, so it cannot require being active already.
 * - **Active scope** (`isActiveOverlay`) — the caller must additionally be the overlay
 *   the user is currently interacting with. Used by every route that produces or ends a
 *   result. Session scope alone is not enough: after the user moves to display B, a
 *   delayed request from display A's overlay would otherwise copy or save A's stale
 *   selection.
 *
 * A failed predicate returns silently rather than throwing — a late call is a normal
 * race (Esc pressed while another overlay is still reporting), not an error.
 */
export const screenshotHandlers: IpcHandlersFor<typeof screenshotRequestSchemas> = {
  // Deliberately only sender-scoped: this is how an in-app control starts a capture, and
  // no session exists yet, so any session predicate would make the feature unreachable.
  // `startCapture` refuses when the feature is off or a session is already up.
  'screenshot.capture': async () => {
    // Awaited so a failure reaches the caller instead of becoming an unhandled rejection.
    await application.get('ScreenshotOverlayService').startCapture()
  },
  'screenshot.commit': async (result, ctx) => {
    const service = application.get('ScreenshotOverlayService')
    if (!ctx.senderId || !service.isActiveOverlay(ctx.senderId)) return
    service.commit(result)
  },
  'screenshot.save': async (result, ctx) => {
    const service = application.get('ScreenshotOverlayService')
    if (!ctx.senderId || !service.isActiveOverlay(ctx.senderId)) return
    await service.save(result)
  },
  // Session-scoped only: Esc on ANY overlay should cancel the whole capture.
  'screenshot.cancel': async (_input, ctx) => {
    const service = application.get('ScreenshotOverlayService')
    if (!ctx.senderId || !service.isSessionOverlay(ctx.senderId)) return
    service.dismiss()
  },
  'screenshot.overlay_active': async (_input, ctx) => {
    const service = application.get('ScreenshotOverlayService')
    if (!ctx.senderId || !service.isSessionOverlay(ctx.senderId)) return
    service.markOverlayActive(ctx.senderId)
  },
  // Session-scoped: hovering an overlay only redirects the keyboard, it neither
  // produces a result nor disturbs the active overlay's selection.
  'screenshot.overlay_focus': async (_input, ctx) => {
    const service = application.get('ScreenshotOverlayService')
    if (!ctx.senderId || !service.isSessionOverlay(ctx.senderId)) return
    service.focusOverlay(ctx.senderId)
  },
  'screenshot.overlay_ready': async ({ mediaId }, ctx) => {
    const service = application.get('ScreenshotOverlayService')
    if (!ctx.senderId || !service.isSessionOverlay(ctx.senderId)) return
    service.markOverlayReady(ctx.senderId, mediaId)
  },
  'screenshot.recognize_text': async ({ mediaId, region }, ctx) => {
    const service = application.get('ScreenshotOverlayService')
    // Active, not merely session: OCR is the most expensive thing an overlay can
    // ask for, so it should be no more permissive than commit/save.
    if (!ctx.senderId || !service.isActiveOverlay(ctx.senderId)) return { status: 'rejected' }
    return service.recognizeText(ctx.senderId, mediaId, region)
  }
}
