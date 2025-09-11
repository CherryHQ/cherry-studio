import { z } from 'zod'

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

export const MCPToolOutputSchema = z
  .object({
    type: z.literal('object'),
    properties: z.object({}).loose().optional(),
    required: z.array(z.string()).optional()
  })
  .loose()

export const MCPToolInputSchema = z
  .object({
    type: z.literal('object'),
    properties: z.object({}).loose().optional(),
    required: z.array(z.string()).optional()
  })
  .loose()

export interface BuiltinTool extends BaseTool {
  inputSchema: z.infer<typeof MCPToolInputSchema>
  type: 'builtin'
}

export interface MCPTool extends BaseTool {
  id: string
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema: z.infer<typeof MCPToolInputSchema>
  outputSchema?: z.infer<typeof MCPToolOutputSchema>
  isBuiltIn?: boolean // 标识是否为内置工具，内置工具不需要通过MCP协议调用
  type: 'mcp'
}
