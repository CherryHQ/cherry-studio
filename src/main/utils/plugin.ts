import * as z from 'zod'

// Plugin Metadata Type
export const PluginMetadataSchema = z.object({
  // Identification
  sourcePath: z.string(), // e.g., "agents/ai-specialists/ai-ethics-advisor.md" or "skills/my-skill"
  filename: z.string(), // IMPORTANT: Semantics vary by type:
  // - For agents/commands: includes .md extension (e.g., "my-agent.md")
  // - For skills: folder name only, no extension (e.g., "my-skill")
  name: z.string(), // Display name from frontmatter or filename
  slug: z.string().optional(), // Stable marketplace identifier from skill frontmatter

  // Content
  description: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(), // from frontmatter (for commands and skills)
  tools: z.array(z.string()).optional(), // from frontmatter (for agents and skills)
  context: z.string().optional(), // skill execution context (for example, "fork")
  agent: z.string().optional(), // subagent selected by a forked skill

  // Organization
  category: z.string(), // derived from parent folder name
  type: z.enum(['agent', 'command', 'skill']),
  tags: z.array(z.string()).optional(),

  // Versioning (for future updates)
  version: z.string().optional(),
  author: z.string().optional(),

  // Metadata
  size: z.number().nullable(), // file size in bytes
  contentHash: z.string(), // SHA-256 hash for change detection
  installedAt: z.number().optional(), // Unix timestamp (for installed plugins)
  updatedAt: z.number().optional(), // Unix timestamp (for installed plugins)

  // Package tracking (for ZIP-installed plugins)
  packageName: z.string().optional(), // Parent package name (e.g., "my-plugin")
  packageVersion: z.string().optional() // Package version from plugin.json
})

export type PluginMetadata = z.infer<typeof PluginMetadataSchema>
