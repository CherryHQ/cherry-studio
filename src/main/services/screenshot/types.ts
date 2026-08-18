/** A connected display, as reported by the native capture backend. */
export interface MonitorInfo {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
  isPrimary: boolean
}

/** One captured display image. */
export interface CaptureResult {
  /** Raw PNG bytes. */
  buffer: Buffer
  /** Width in physical pixels. */
  width: number
  /** Height in physical pixels. */
  height: number
}

/** A foreign application window, used for hover-to-snap hit testing. */
export interface RawWindowInfo {
  pid: number
  title: string
  appName: string
  x: number
  y: number
  width: number
  height: number
  isMinimized: boolean
}

/**
 * Thrown ONLY when the OS permission state is genuinely not authorized.
 * Never use it as a catch-all: it steers the user into System Settings, which
 * is the wrong fix for an encoder fault or a failed native load.
 */
export class ScreenCapturePermissionError extends Error {
  constructor() {
    super('Screen recording permission is required.')
    this.name = 'ScreenCapturePermissionError'
  }
}

/** Any other capture failure — encoder fault, native load failure, a single display failing. */
export class ScreenCaptureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ScreenCaptureError'
  }
}
