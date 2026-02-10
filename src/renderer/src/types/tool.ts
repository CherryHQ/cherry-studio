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
  type: z.literal('builtin'),
  inputSchema: MCPToolInputSchema
})

export type BuiltinTool = z.infer<typeof BuiltinToolSchema>

const MCPToolSchema = z.object({
  ...BaseToolSchemaConfig,
  type: z.literal('mcp'),
  serverId: z.string(),
  serverName: z.string(),
  inputSchema: MCPToolInputSchema,
  outputSchema: MCPToolOutputSchema.optional(),
  /** Identifies whether it's a built-in tool. Built-in tools don't need to be called via the MCP protocol */
  isBuiltIn: z.boolean().optional()
})

export type MCPTool = z.infer<typeof MCPToolSchema>
