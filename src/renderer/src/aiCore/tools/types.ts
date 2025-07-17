import { Tool } from '@cherrystudio/ai-core'

export type ToolCallResult = {
  success: boolean
  data: any
}

export type AiSdkTool = Tool<any, ToolCallResult>
