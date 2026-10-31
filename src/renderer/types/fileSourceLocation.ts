export interface FileSourceLocation {
  /** One-based source line; a new object requests another reveal of the same location. */
  line: number
}
