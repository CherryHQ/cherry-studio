/** One-based source coordinates; the end line is inclusive. */
export interface FileLocation {
  line: number
  column?: number
  endLine?: number
}
