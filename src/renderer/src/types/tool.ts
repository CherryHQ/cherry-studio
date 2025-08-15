import * as z from 'zod/v4'

export type ToolType = 'builtin' | 'provider' | 'mcp'

export interface BaseTool {
  id: string
  name: string
  description?: string
  type: ToolType
}

// export interface ToolCallResponse {
//   id: string
//   toolName: string
//   arguments: Record<string, unknown> | undefined
//   status: 'invoking' | 'completed' | 'error'
//   result?: any // AI SDK的工具执行结果
//   error?: string
//   providerExecuted?: boolean // 标识是Provider端执行还是客户端执行
// }

export const MCPToolOutputSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string())
})

export interface MCPToolInputSchema {
  type: string
  title: string
  description?: string
  required?: string[]
  properties: Record<string, object>
}

export interface BuiltinTool extends BaseTool {
  inputSchema: MCPToolInputSchema
  type: 'builtin'
}

export interface MCPTool extends BaseTool {
  serverId: string
  serverName: string
  inputSchema: MCPToolInputSchema
  outputSchema?: z.infer<typeof MCPToolOutputSchema>
  type: 'mcp'
}
