/** A foreign window projected into one display's overlay coordinate space (DIP). */
export interface DetectedWindow {
  title: string
  appName: string
  x: number
  y: number
  width: number
  height: number
}

/** Init data handed to one overlay window. */
export interface ScreenshotInitData {
  /** `cherry-media://image/{id}` URL of this display's frozen capture. */
  imageUrl: string
  /** Id of the same entry, so region requests can name it without re-parsing the URL. */
  mediaId: string
  display: {
    id: number
    /** Display origin in the virtual desktop, in DIP. */
    x: number
    y: number
    /** Capture size in physical pixels. */
    width: number
    height: number
    scaleFactor: number
  }
  /** Foreign windows overlapping this display, for hover-to-snap. */
  windows: DetectedWindow[]
  /** Whether the overlay should run OCR once a selection settles. */
  autoOcr: boolean
  /** Whether the OCR model is on disk; false disables the OCR affordance. */
  ocrAvailable: boolean
}

/**
 * The overlay's finished output.
 *
 * Deliberately carries ONLY the image. The source implementation also sent a
 * `bounds` rect (`selection * scaleFactor`), but nothing consumed it beyond one
 * log line — and at 1.25 / 1.5 display scaling that product is fractional, so
 * any integer constraint on it would reject perfectly good captures, while no
 * constraint would let a meaningless value through. The pixel size is recoverable
 * from the image itself if a consumer ever needs it.
 */
export interface ScreenshotResultData {
  /** Encoded PNG of the cropped, annotated selection. */
  pngBytes: Uint8Array
}
