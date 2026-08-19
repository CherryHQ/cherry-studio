import { z } from 'zod'

// Schema for MCP server ID parameter
export const MCPServerIdSchema = z.object({
  serverId: z.string().min(1, 'Server ID is required')
})

// Schema for calling an MCP tool
export const CallMCPToolSchema = z.object({
  serverId: z.string().min(1, 'Server ID is required'),
  toolName: z.string().min(1, 'Tool name is required'),
  arguments: z.record(z.unknown()).optional()
})

// Schema for getting an MCP resource
export const GetMCPResourceSchema = z.object({
  serverId: z.string().min(1, 'Server ID is required'),
  resourceUri: z.string().min(1, 'Resource URI is required')
})

// Schema for getting an MCP prompt
export const GetMCPPromptSchema = z.object({
  serverId: z.string().min(1, 'Server ID is required'),
  promptName: z.string().min(1, 'Prompt name is required'),
  arguments: z.record(z.string()).optional()
})

// Schema for creating/updating an MCP server
export const CreateMCPServerSchema = z.object({
  name: z.string().min(1, 'Server name is required'),
  type: z.enum(['stdio', 'http', 'sse']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().url().optional(),
  isActive: z.boolean().optional()
})

// Schema for updating an MCP server
export const UpdateMCPServerSchema = z.object({
  name: z.string().optional(),
  type: z.enum(['stdio', 'http', 'sse']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().url().optional(),
  isActive: z.boolean().optional()
})
