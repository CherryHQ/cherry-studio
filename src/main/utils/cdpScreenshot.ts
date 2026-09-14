import type { WebContents } from 'electron'
import { BrowserWindow, screen } from 'electron'

import { loggerService } from '@logger'

const logger = loggerService.withContext('Utils:cdpScreenshot')

export interface CdpScreenshotClip {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Main-side ceiling on rasterized output (device px) — Chromium's composited
 * surface cannot exceed this. Renderer applies a tighter per-window bound.
 */
const MAX_SCREENSHOT_PHYSICAL_DIMENSION = 16384

/**
 * Device-pixel ratio of the display hosting `wc`. CDP clip coordinates are CSS
 * px and clip.scale multiplies ON TOP of this factor, so the physical output
 * is clip × scale × DPR. Falls back to 1 when the window cannot be resolved.
 */
function displayScaleFactor(wc: WebContents): number {
  const win = BrowserWindow.fromWebContents(wc)
  if (!win || win.isDestroyed()) return 1
  return screen.getDisplayMatching(win.getBounds()).scaleFactor || 1
}

/**
 * Rasterize a page-space region of `wc` through Chromium's own compositor via CDP
 * `Page.captureScreenshot` — the same mechanism Puppeteer and DevTools' "capture
 * node screenshot" use. Unlike DOM-clone rasterizers (html-to-image), the compositor
 * outputs what the page actually shows: same fonts, same layout, same effects.
 *
 * `captureBeyondViewport: true` lets the clip cover content scrolled out of view by
 * temporarily extending the composited surface (Chromium handles this internally;
 * no visible viewport change is applied to the page).
 *
 * Electron allows exactly one debugger client per webContents. We attach only for
 * the duration of the command and detach afterwards; if some other client already
 * owns the session we still send through it but never detach what we did not attach.
 */
export async function captureScreenshotViaCdp(
  wc: WebContents,
  clip: CdpScreenshotClip,
  scale: number
): Promise<string> {
  if (wc.isDestroyed()) {
    throw new Error('webContents is destroyed')
  }
  // Output = clip × scale × the host display's device-pixel ratio (applied by
  // the compositor). Guard the full physical product so an arbitrary request
  // cannot arm an oversized capture; scale ≥ 1 is already enforced by the schema.
  const dpr = displayScaleFactor(wc)
  if (
    clip.width * scale * dpr > MAX_SCREENSHOT_PHYSICAL_DIMENSION ||
    clip.height * scale * dpr > MAX_SCREENSHOT_PHYSICAL_DIMENSION
  ) {
    throw new Error(`Screenshot clip exceeds the composited-surface limit (${MAX_SCREENSHOT_PHYSICAL_DIMENSION}px)`)
  }

  const dbg = wc.debugger
  const wasAttached = dbg.isAttached()
  if (!wasAttached) {
    try {
      dbg.attach('1.3')
    } catch (error) {
      // Another client owns the session (e.g. a remote-debugging connection or an
      // already-attached feature). Treat as unavailable — the caller falls back to
      // the html-to-image path rather than shipping a broken export.
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(
        'CDP attach failed, native screenshot unavailable',
        error instanceof Error ? error : new Error(message)
      )
      throw new Error(`CDP attach failed: ${message}`)
    }
  }

  try {
    const result = (await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      clip: { ...clip, scale },
      captureBeyondViewport: true,
      fromSurface: true
    })) as { data?: string }

    if (!result?.data) {
      throw new Error('Page.captureScreenshot returned no image data')
    }
    return `data:image/png;base64,${result.data}`
  } finally {
    if (!wasAttached && !wc.isDestroyed() && dbg.isAttached()) {
      dbg.detach()
    }
  }
}
