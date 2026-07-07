export interface CodeToolsRunResult {
  success: boolean
  message: string
}

export type OperationResult = { success: true } | { success: false; message: string }
