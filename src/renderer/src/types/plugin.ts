import { z } from 'zod'

// Plugin Metadata Type
export const PluginMetadataSchema = z.object({
  // Identification
  sourcePath: z.string(), // e.g., "agents/ai-specialists/ai-ethics-advisor.md"
  filename: z.string(), // e.g., "ai-ethics-advisor.md" (unique destination name)
  name: z.string(), // Display name from frontmatter or filename

  // Content
  description: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(), // from frontmatter (for commands)
  tools: z.array(z.string()).optional(), // from frontmatter (for agents)

  // Organization
  category: z.string(), // derived from parent folder name
  type: z.enum(['agent', 'command']),
  tags: z.array(z.string()).optional(),

  // Versioning (for future updates)
  version: z.string().optional(),
  author: z.string().optional(),

  // Metadata
  size: z.number(), // file size in bytes
  contentHash: z.string(), // SHA-256 hash for change detection
  installedAt: z.number().optional(), // Unix timestamp (for installed plugins)
  updatedAt: z.number().optional() // Unix timestamp (for installed plugins)
})

export type PluginMetadata = z.infer<typeof PluginMetadataSchema>

export const InstalledPluginSchema = z.object({
  filename: z.string(),
  type: z.enum(['agent', 'command']),
  metadata: PluginMetadataSchema
})

export type InstalledPlugin = z.infer<typeof InstalledPluginSchema>

// Error handling types
export type PluginError =
  | { type: 'PATH_TRAVERSAL'; message: string; path: string }
  | { type: 'FILE_NOT_FOUND'; path: string }
  | { type: 'PERMISSION_DENIED'; path: string }
  | { type: 'INVALID_METADATA'; reason: string; path: string }
  | { type: 'FILE_TOO_LARGE'; size: number; max: number }
  | { type: 'DUPLICATE_FILENAME'; filename: string }
  | { type: 'INVALID_WORKDIR'; workdir: string; agentId: string; message?: string }
  | { type: 'INVALID_FILE_TYPE'; extension: string }
  | { type: 'WORKDIR_NOT_FOUND'; workdir: string }
  | { type: 'DISK_SPACE_ERROR'; required: number; available: number }
  | { type: 'TRANSACTION_FAILED'; operation: string; reason: string }
  | { type: 'READ_FAILED'; path: string; reason: string }
  | { type: 'WRITE_FAILED'; path: string; reason: string }
  | { type: 'PLUGIN_NOT_INSTALLED'; filename: string; agentId: string }

export type PluginResult<T> = { success: true; data: T } | { success: false; error: PluginError }

export interface InstallPluginOptions {
  agentId: string
  sourcePath: string
  type: 'agent' | 'command'
}

export interface UninstallPluginOptions {
  agentId: string
  filename: string
  type: 'agent' | 'command'
}

export interface WritePluginContentOptions {
  agentId: string
  filename: string
  type: 'agent' | 'command'
  content: string
}

export interface ListAvailablePluginsResult {
  agents: PluginMetadata[]
  commands: PluginMetadata[]
  total: number
}

// IPC Channel Constants
export const CLAUDE_CODE_PLUGIN_IPC_CHANNELS = {
  LIST_AVAILABLE: 'claudeCodePlugin:list-available',
  INSTALL: 'claudeCodePlugin:install',
  UNINSTALL: 'claudeCodePlugin:uninstall',
  LIST_INSTALLED: 'claudeCodePlugin:list-installed',
  INVALIDATE_CACHE: 'claudeCodePlugin:invalidate-cache'
} as const
