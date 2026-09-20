import * as z from 'zod'

import type { DetectedWindow, ScreenshotResultData } from '@shared/types/screenshot'

import { defineRoute } from '../define'
import { uint8ArraySchema } from './common'

/**
 * Screenshot IPC — overlay windows report their outcome back to the main process.
 *
 * Two blocks per the framework's two-axis model:
 *   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
 *   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
 */

/**
 * Max accepted result payload. A 4K full-screen PNG lands around 15–25 MB; 48 MB leaves
 * headroom for a dense annotated capture on a large HiDPI display while still bounding
 * what a compromised renderer can make the main process allocate in one call.
 */
const MAX_RESULT_BYTES = 48 * 1024 * 1024

/**
 * Widest OCR region accepted, per side. A selection cannot exceed the display it
 * was drawn on, and 8K covers the largest realistic panel; the cap exists so one
 * request cannot queue unbounded work onto the shared inference worker.
 */
const MAX_OCR_REGION_SIDE = 8192

/** Runtime form of {@link ScreenshotResultData}; the annotation binds the two structurally. */
const screenshotResultSchema: z.ZodType<ScreenshotResultData> = z.object({
  // Raw bytes rather than a data URL: base64 adds a third to a payload that is already
  // tens of MB, plus an encode in the renderer and a decode in main.
  pngBytes: uint8ArraySchema.refine(
    (bytes) => bytes.byteLength <= MAX_RESULT_BYTES,
    'screenshot result exceeds the size cap'
  )
})

/** One recognized text run with its box in the capture's physical pixel space. */
const ocrWord = z.object({
  text: z.string(),
  box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  confidence: z.number()
})

/**
 * One recognized text run, as the OCR route reports it.
 *
 * Crosses the IPC boundary, so it lives here rather than in the main-only
 * inference protocol — the renderer has no `@main/*` path to import from.
 */
export type OcrWord = z.infer<typeof ocrWord>

// Discriminated on purpose: a bare `lines: []` cannot tell "this region has no text"
// apart from "the model was deleted" or "this request no longer applies".
const ocrRecognitionResult = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    /** Grouped by line, in reading order; the inner array is words on that line. */
    lines: z.array(z.array(ocrWord))
  }),
  /** Local OCR model not ready — never downloaded, or removed just now. */
  z.object({ status: z.literal('unavailable') }),
  /** Request no longer applies: not the active overlay, foreign mediaId, session
   *  already gone, or the clamped region degenerated to nothing. Not an error. */
  z.object({ status: z.literal('rejected') })
])

/** The single definition both the route and the service implement. */
export type OcrRecognitionResult = z.infer<typeof ocrRecognitionResult>

// ── Request: renderer→main calls (zod values, always parsed) ──
export const screenshotRequestSchemas = {
  /**
   * Start a capture session from an in-app control, e.g. a composer's screenshot button.
   * The shortcut does not come through here — it runs in main via `CommandService`.
   */
  'screenshot.capture': defineRoute({ input: z.void(), output: z.void() }),
  /** Selection confirmed — copy to the clipboard and dismiss every overlay. */
  'screenshot.commit': defineRoute({ input: screenshotResultSchema, output: z.void() }),
  /** Selection confirmed — save to a user-chosen file and dismiss every overlay. */
  'screenshot.save': defineRoute({ input: screenshotResultSchema, output: z.void() }),
  /** Dismiss every overlay without producing anything. */
  'screenshot.cancel': defineRoute({ input: z.void(), output: z.void() }),
  /** The calling overlay took over the interaction; the previously active one resets. */
  'screenshot.overlay_active': defineRoute({ input: z.void(), output: z.void() }),
  /**
   * Make the calling overlay the keyboard target, sent when the cursor enters it.
   *
   * Deliberately NOT `screenshot.overlay_active`: that one means "took over the
   * interaction" and resets the previously active overlay's selection, which must
   * not happen on mere hover. Only the cursor's display is focused at reveal time,
   * so without this the per-overlay keys (Shift, C, arrows, undo) keep acting on
   * the overlay the user has already moved away from.
   */
  'screenshot.overlay_focus': defineRoute({ input: z.void(), output: z.void() }),
  /**
   * The calling overlay has decoded its capture and painted the first frame.
   * Main reveals the window only after this — `ready-to-show` fires long before
   * the image exists. Carries the mediaId so a stale overlay from a previous
   * session cannot reveal itself into the current one.
   */
  'screenshot.overlay_ready': defineRoute({ input: z.object({ mediaId: z.string() }), output: z.void() }),
  /**
   * The text-annotation editor opened (`true`) or closed (`false`) on the calling overlay.
   *
   * macOS only in effect. The IME candidate window is placed at a fixed, low window level
   * for a Chromium client, so an overlay sitting above the Dock and menu bar covers the
   * candidates completely — text can be composed but nothing can be chosen. Main drops
   * this overlay below that level while the editor is open and restores it on close.
   */
  'screenshot.text_editing': defineRoute({ input: z.object({ editing: z.boolean() }), output: z.void() }),
  /**
   * OCR a region of the frozen capture. Cropping happens in main so the full-size
   * image never crosses the process boundary.
   *
   * Region is in the capture's own PHYSICAL pixel space and must be integral —
   * `sharp.extract()` rejects fractional rects, and HiDPI overlays compute their
   * selection in CSS px, so the renderer multiplies by scaleFactor and rounds
   * before sending. Main additionally clamps to the image bounds (a rounded rect
   * can land one pixel past the edge). MAX_OCR_REGION_SIDE bounds the work a
   * single request can queue onto the inference worker.
   */
  'screenshot.recognize_text': defineRoute({
    input: z.object({
      mediaId: z.string(),
      region: z.object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive().max(MAX_OCR_REGION_SIDE),
        height: z.number().int().positive().max(MAX_OCR_REGION_SIDE)
      })
    }),
    output: ocrRecognitionResult
  })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type ScreenshotEventSchemas = {
  /** Sent to an overlay that lost the interaction, telling it to drop its selection. */
  'screenshot.reset_overlay': void
  /**
   * The hover-to-snap targets for this overlay's display.
   *
   * Pushed instead of travelling in the init data: enumerating them costs hundreds
   * of milliseconds with a normal working set, and paying that before the overlays
   * open made it the dominant part of the shortcut's latency. An overlay is fully
   * usable without it — until it arrives, hovering simply snaps to the whole display.
   */
  'screenshot.snap_targets': { windows: DetectedWindow[] }
  /**
   * The session is over. A pooled overlay is only hidden, never unmounted, so nothing
   * else tells its renderer to let go of the decoded capture until the next session.
   */
  'screenshot.session_ended': void
}
