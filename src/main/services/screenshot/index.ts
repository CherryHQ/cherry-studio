/**
 * Screen capture — display / window enumeration and whole-screen capture. This barrel
 * is the module's only public door: the `barrel/closed` lint rule rejects deep imports
 * of `./screenCapture`, `./types` and the rest.
 *
 * The macOS permission gate deliberately lives in `@main/utils/screenCapturePermission`
 * instead: importing it through here would drag the overlay service into the caller.
 */
export { loadNativeCaptureBackend } from './nativeCaptureBackend'
export { captureAllMonitors, listMonitors } from './screenCapture'
export { ScreenshotOverlayService } from './ScreenshotOverlayService'
export { ScreenCaptureError, ScreenCapturePermissionError } from './types'
