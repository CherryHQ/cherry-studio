import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

import matter from 'gray-matter'
import * as yaml from 'js-yaml'

import type { PluginMetadata } from '@types'

/**
 * Parse plugin metadata from a markdown file with frontmatter
 * @param filePath Absolute path to the markdown file
 * @param sourcePath Relative source path from plugins directory
 * @param category Category name derived from parent folder
 * @param type Plugin type (agent or command)
 * @returns PluginMetadata object with parsed frontmatter and file info
 */
export async function parsePluginMetadata(
  filePath: string,
  sourcePath: string,
  category: string,
  type: 'agent' | 'command'
): Promise<PluginMetadata> {
  const content = await fs.promises.readFile(filePath, 'utf8')
  const stats = await fs.promises.stat(filePath)

  // Parse frontmatter safely with FAILSAFE_SCHEMA to prevent deserialization attacks
  const { data } = matter(content, {
    engines: {
      yaml: (s) => yaml.load(s, { schema: yaml.FAILSAFE_SCHEMA })
    }
  })

  // Calculate content hash for integrity checking
  const contentHash = crypto.createHash('sha256').update(content).digest('hex')

  // Extract filename
  const filename = path.basename(filePath)

  // Parse allowed_tools - handle both array and comma-separated string
  let allowedTools: string[] | undefined
  if (data['allowed-tools'] || data.allowed_tools) {
    const toolsData = data['allowed-tools'] || data.allowed_tools
    if (Array.isArray(toolsData)) {
      allowedTools = toolsData
    } else if (typeof toolsData === 'string') {
      allowedTools = toolsData
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }
  }

  // Parse tools - similar handling
  let tools: string[] | undefined
  if (data.tools) {
    if (Array.isArray(data.tools)) {
      tools = data.tools
    } else if (typeof data.tools === 'string') {
      tools = data.tools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }
  }

  // Parse tags
  let tags: string[] | undefined
  if (data.tags) {
    if (Array.isArray(data.tags)) {
      tags = data.tags
    } else if (typeof data.tags === 'string') {
      tags = data.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }
  }

  return {
    sourcePath,
    filename,
    name: data.name || filename.replace(/\.md$/, ''),
    description: data.description,
    allowed_tools: allowedTools,
    tools,
    category,
    type,
    tags,
    version: data.version,
    author: data.author,
    size: stats.size,
    contentHash
  }
}
