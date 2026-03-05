import * as z from 'zod'

// Plugin Type
export type PluginType = 'agent' | 'command' | 'skill'

// Plugin Metadata Type
export const PluginMetadataSchema = z.object({
  // Identification
  sourcePath: z.string(), // e.g., "agents/ai-specialists/ai-ethics-advisor.md" or "skills/my-skill"
  filename: z.string(), // IMPORTANT: Semantics vary by type:
  // - For agents/commands: includes .md extension (e.g., "my-agent.md")
  // - For skills: folder name only, no extension (e.g., "my-skill")
  name: z.string(), // Display name from frontmatter or filename

  // Content
  description: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(), // from frontmatter (for commands)
  tools: z.array(z.string()).optional(), // from frontmatter (for agents and skills)

  // Organization
  category: z.string(), // derived from parent folder name
  type: z.enum(['agent', 'command', 'skill']), // UPDATED: now includes 'skill'
  tags: z.array(z.string()).optional(),

  // Versioning (for future updates)
  version: z.string().optional(),
  author: z.string().optional(),

  // Metadata
  size: z.number(), // file size in bytes
  contentHash: z.string(), // SHA-256 hash for change detection
  installedAt: z.number().optional(), // Unix timestamp (for installed plugins)
  updatedAt: z.number().optional(), // Unix timestamp (for installed plugins)

  // Package tracking (for ZIP-installed plugins)
  packageName: z.string().optional(), // Parent package name (e.g., "my-plugin")
  packageVersion: z.string().optional() // Package version from plugin.json
})

export type PluginMetadata = z.infer<typeof PluginMetadataSchema>

export const InstalledPluginSchema = z.object({
  filename: z.string(),
  type: z.enum(['agent', 'command', 'skill']),
  metadata: PluginMetadataSchema
})

export type InstalledPlugin = z.infer<typeof InstalledPluginSchema>

// Cache file schema for .claude/plugins.json
export const CachedPluginsDataSchema = z.object({
  version: z.number().default(1),
  lastUpdated: z.number(), // Unix timestamp in milliseconds
  plugins: z.array(InstalledPluginSchema)
})

export type CachedPluginsData = z.infer<typeof CachedPluginsDataSchema>

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
  | { type: 'INVALID_ZIP_FORMAT'; path: string; reason: string }
  | { type: 'SKILL_MD_NOT_FOUND'; path: string }
  | { type: 'ZIP_EXTRACTION_FAILED'; path: string; reason: string }
  | { type: 'PLUGIN_MANIFEST_NOT_FOUND'; path: string }
  | { type: 'PLUGIN_MANIFEST_INVALID'; path: string; reason: string }
  | { type: 'EMPTY_PLUGIN_PACKAGE'; path: string }
  | { type: 'PLUGIN_PACKAGE_NOT_FOUND'; packageName: string }

export type PluginResult<T> = { success: true; data: T } | { success: false; error: PluginError }

export interface InstallPluginOptions {
  agentId: string
  sourcePath: string
  type: 'agent' | 'command' | 'skill'
}

export interface UninstallPluginOptions {
  agentId: string
  filename: string
  type: 'agent' | 'command' | 'skill'
}

// Package-level uninstall options
export interface UninstallPluginPackageOptions {
  agentId: string
  packageName: string
}

// Package-level uninstall result
export interface UninstallPluginPackageResult {
  packageName: string
  uninstalledComponents: Array<{ filename: string; type: PluginType }>
  directoryRemoved: boolean
}

export interface WritePluginContentOptions {
  agentId: string
  filename: string
  type: 'agent' | 'command' | 'skill'
  content: string
}

export interface InstallSkillFromZipOptions {
  agentId: string
  zipFilePath: string
}

// Plugin package installation options (for ZIP upload)
export interface InstallFromZipOptions {
  agentId: string
  zipFilePath: string
}

// Single plugin package installation result
export interface SinglePluginInstallResult {
  pluginName: string // Plugin name from plugin.json
  installed: PluginMetadata[] // Successfully installed items
  failed: Array<{ path: string; error: string }> // Failed items
}

// Plugin package installation result (supports multiple packages from ZIP, directory, or marketplace)
export interface InstallFromSourceResult {
  packages: SinglePluginInstallResult[] // Results for each plugin package
  totalInstalled: number // Total successfully installed components
  totalFailed: number // Total failed components
}

/** @deprecated Use InstallFromSourceResult instead */
export type InstallFromZipResult = InstallFromSourceResult

// Plugin directory installation options (for folder upload)
export interface InstallFromDirectoryOptions {
  agentId: string
  directoryPath: string
}

// Plugin manifest schema (.claude-plugin/plugin.json)
// Reference: https://code.claude.com/docs/en/plugins-reference
export const PluginAuthorSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  url: z.string().optional()
})

export const PluginManifestSchema = z.object({
  // Required field
  name: z.string().min(1), // kebab-case, no spaces

  // Metadata fields
  version: z.string().optional(),
  description: z.string().optional(),
  author: PluginAuthorSchema.optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),

  // Component path fields (relative paths, start with ./)
  commands: z.union([z.string(), z.array(z.string())]).optional(),
  agents: z.union([z.string(), z.array(z.string())]).optional(),
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  outputStyles: z.union([z.string(), z.array(z.string())]).optional(),

  // Config fields (path string or inline object)
  hooks: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  mcpServers: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  lspServers: z.union([z.string(), z.record(z.string(), z.unknown())]).optional()
})

export type PluginAuthor = z.infer<typeof PluginAuthorSchema>
export type PluginManifest = z.infer<typeof PluginManifestSchema>

// Marketplace manifest schema (.claude-plugin/marketplace.json)
// Reference: https://code.claude.com/docs/en/plugin-marketplaces#marketplace-schema
export const MarketplaceOwnerSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  url: z.string().optional()
})

export const MarketplacePluginSourceSchema = z.union([
  z.string(),
  z.object({
    github: z.string().optional(),
    npm: z.string().optional(),
    git: z.string().optional()
  })
])

// Marketplace plugin entry extends PluginManifest with marketplace-specific fields
export const MarketplacePluginEntrySchema = PluginManifestSchema.extend({
  source: MarketplacePluginSourceSchema,
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  strict: z.boolean().optional()
})

export const MarketplaceMetadataSchema = z.object({
  description: z.string().optional(),
  version: z.string().optional(),
  pluginRoot: z.string().optional()
})

export const MarketplaceManifestSchema = z.object({
  name: z.string().min(1),
  owner: MarketplaceOwnerSchema,
  plugins: z.array(MarketplacePluginEntrySchema),
  metadata: MarketplaceMetadataSchema.optional()
})

export type MarketplaceOwner = z.infer<typeof MarketplaceOwnerSchema>
export type MarketplacePluginEntry = z.infer<typeof MarketplacePluginEntrySchema>
export type MarketplaceMetadata = z.infer<typeof MarketplaceMetadataSchema>
export type MarketplaceManifest = z.infer<typeof MarketplaceManifestSchema>

// ============================================================================
// Marketplace API Response Schemas
// ============================================================================

/**
 * Schema for plugin resolve API response
 * Handles various property naming conventions (camelCase, snake_case)
 */
export const PluginResolveResponseSchema = z.object({
  gitUrl: z.string().optional(),
  git_url: z.string().optional(),
  url: z.string().optional(),
  repoUrl: z.string().optional(),
  repo_url: z.string().optional()
})

export type PluginResolveResponse = z.infer<typeof PluginResolveResponseSchema>

/**
 * Schema for a resolved skill from v2 API
 */
export const ResolvedSkillSchema = z.object({
  namespace: z.string(),
  name: z.string(),
  relDir: z.string(),
  sourceUrl: z.string()
})

export type ResolvedSkill = z.infer<typeof ResolvedSkillSchema>

/**
 * Schema for v2 skills resolve API response
 */
export const SkillsResolveResponseSchema = z.object({
  skills: z.array(ResolvedSkillSchema)
})

export type SkillsResolveResponse = z.infer<typeof SkillsResolveResponseSchema>

// IPC Channel Constants
export const CLAUDE_CODE_PLUGIN_IPC_CHANNELS = {
  LIST_AVAILABLE: 'claudeCodePlugin:list-available',
  INSTALL: 'claudeCodePlugin:install',
  UNINSTALL: 'claudeCodePlugin:uninstall',
  LIST_INSTALLED: 'claudeCodePlugin:list-installed',
  INVALIDATE_CACHE: 'claudeCodePlugin:invalidate-cache'
} as const
