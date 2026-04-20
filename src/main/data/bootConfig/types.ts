export interface BootConfigLoadError {
  type: 'parse_error' | 'read_error'
  message: string
  filePath: string
  rawContent?: string
}
