export interface CodeToolsRunResult {
  success: boolean
  message: string
  command: string
}

export type OperationResult = { success: true } | { success: false; message: string }
