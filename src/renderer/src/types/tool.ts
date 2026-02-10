import * as z from 'zod'

const ToolTypeSchema = z.enum(['builtin', 'provider', 'mcp'])

export type ToolType = z.infer<typeof ToolTypeSchema>

const BaseToolSchemaConfig = {
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: ToolTypeSchema
}

const BaseToolSchema = z.object(BaseToolSchemaConfig)

export type BaseTool = z.infer<typeof BaseToolSchema>

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
  .transform((schema) => {
    if (!schema.properties) {
      schema.properties = {}
    }
    if (!schema.required) {
      schema.required = []
    }
    return schema
  })

const BuiltinToolSchema = z.object({
  ...BaseToolSchemaConfig,
  inputSchema: MCPToolInputSchema,
  type: z.literal('builtin')
})

export type BuiltinTool = z.infer<typeof BuiltinToolSchema>

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
