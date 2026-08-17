/**
 * Screen capture — display / window enumeration, whole-screen capture, and the
 * macOS screen-recording permission queries. This barrel is the module's only
 * public door: the `barrel/closed` lint rule rejects deep imports of
 * `./screenCapture`, `./types` and the rest.
 */
export type { ScreenCapturePermissionStatus } from './screenCapture'
export {
  captureAllMonitors,
  getScreenCapturePermissionStatus,
  listMonitors,
  listWindows,
  openScreenCaptureSettings,
  requestScreenCapturePermission
} from './screenCapture'
export { ScreenshotOverlayService } from './ScreenshotOverlayService'
export { ScreenCaptureError, ScreenCapturePermissionError } from './types'
