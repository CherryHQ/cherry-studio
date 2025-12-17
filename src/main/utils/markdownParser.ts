import { loggerService } from '@logger'
import type { PluginError, PluginMetadata } from '@types'
import * as crypto from 'crypto'
import * as fs from 'fs'
import matter from 'gray-matter'
import * as yaml from 'js-yaml'
import * as path from 'path'

import { getDirectorySize } from './fileOperations'

const logger = loggerService.withContext('Utils:MarkdownParser')

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
      yaml: (s) => yaml.load(s, { schema: yaml.FAILSAFE_SCHEMA }) as object
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

/**
 * Recursively find all directories containing SKILL.md
 *
 * @param dirPath - Directory to search in
 * @param basePath - Base path for calculating relative source paths
 * @param maxDepth - Maximum depth to search (default: 10 to prevent infinite loops)
 * @param currentDepth - Current search depth (used internally)
 * @returns Array of objects with absolute folder path and relative source path
 */
export async function findAllSkillDirectories(
  dirPath: string,
  basePath: string,
  maxDepth = 10,
  currentDepth = 0
): Promise<Array<{ folderPath: string; sourcePath: string }>> {
  const results: Array<{ folderPath: string; sourcePath: string }> = []

  // Prevent excessive recursion
  if (currentDepth > maxDepth) {
    return results
  }

  // Check if current directory contains SKILL.md
  const skillMdPath = path.join(dirPath, 'SKILL.md')

  try {
    await fs.promises.stat(skillMdPath)
    // Found SKILL.md in this directory
    const relativePath = path.relative(basePath, dirPath)
    results.push({
      folderPath: dirPath,
      sourcePath: relativePath
    })
    return results
  } catch {
    // SKILL.md not in current directory
  }

  // Only search subdirectories if current directory doesn't have SKILL.md
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPath = path.join(dirPath, entry.name)
        const subResults = await findAllSkillDirectories(subDirPath, basePath, maxDepth, currentDepth + 1)
        results.push(...subResults)
      }
    }
  } catch (error: any) {
    // Ignore errors when reading subdirectories (e.g., permission denied)
    logger.debug('Failed to read subdirectory during skill search', {
      dirPath,
      error: error.message
    })
  }

  return results
}

/**
 * Parse metadata from SKILL.md within a skill folder
 *
 * @param skillFolderPath - Absolute path to skill folder (must be absolute and contain SKILL.md)
 * @param sourcePath - Relative path from plugins base (e.g., "skills/my-skill")
 * @param category - Category name (typically "skills" for flat structure)
 * @returns PluginMetadata with folder name as filename (no extension)
 * @throws PluginError if SKILL.md not found or parsing fails
 */
export async function parseSkillMetadata(
  skillFolderPath: string,
  sourcePath: string,
  category: string
): Promise<PluginMetadata> {
  // Input validation
  if (!skillFolderPath || !path.isAbsolute(skillFolderPath)) {
    throw {
      type: 'INVALID_METADATA',
      reason: 'Skill folder path must be absolute',
      path: skillFolderPath
    } as PluginError
  }

  // Look for SKILL.md directly in this folder (no recursion)
  const skillMdPath = path.join(skillFolderPath, 'SKILL.md')

  // Check if SKILL.md exists
  try {
    await fs.promises.stat(skillMdPath)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.error('SKILL.md not found in skill folder', { skillMdPath })
      throw {
        type: 'FILE_NOT_FOUND',
        path: skillMdPath,
        message: 'SKILL.md not found in skill folder'
      } as PluginError
    }
    throw error
  }

  // Read SKILL.md content
  let content: string
  try {
    content = await fs.promises.readFile(skillMdPath, 'utf8')
  } catch (error: any) {
    logger.error('Failed to read SKILL.md', { skillMdPath, error })
    throw {
      type: 'READ_FAILED',
      path: skillMdPath,
      reason: error.message || 'Unknown error'
    } as PluginError
  }

  // Parse frontmatter safely with FAILSAFE_SCHEMA to prevent deserialization attacks
  let data: any
  try {
    const parsed = matter(content, {
      engines: {
        yaml: (s) => yaml.load(s, { schema: yaml.FAILSAFE_SCHEMA }) as object
      }
    })
    data = parsed.data
  } catch (error: any) {
    logger.error('Failed to parse SKILL.md frontmatter', { skillMdPath, error })
    throw {
      type: 'INVALID_METADATA',
      reason: `Failed to parse frontmatter: ${error.message}`,
      path: skillMdPath
    } as PluginError
  }

  // Calculate hash of SKILL.md only (not entire folder)
  // Note: This means changes to other files in the skill won't trigger cache invalidation
  // This is intentional - only SKILL.md metadata changes should trigger updates
  const contentHash = crypto.createHash('sha256').update(content).digest('hex')

  // Get folder name as identifier (NO EXTENSION)
  const folderName = path.basename(skillFolderPath)

  // Get total folder size
  let folderSize: number
  try {
    folderSize = await getDirectorySize(skillFolderPath)
  } catch (error: any) {
    logger.error('Failed to calculate skill folder size', { skillFolderPath, error })
    // Use 0 as fallback instead of failing completely
    folderSize = 0
  }

  // Parse tools (skills use 'tools', not 'allowed_tools')
  let tools: string[] | undefined
  if (data.tools) {
    if (Array.isArray(data.tools)) {
      // Validate all elements are strings
      tools = data.tools.filter((t) => typeof t === 'string')
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
      // Validate all elements are strings
      tags = data.tags.filter((t) => typeof t === 'string')
    } else if (typeof data.tags === 'string') {
      tags = data.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }
  }

  // Validate and sanitize name
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : folderName

  // Validate and sanitize description
  const description =
    typeof data.description === 'string' && data.description.trim() ? data.description.trim() : undefined

  // Validate version and author
  const version = typeof data.version === 'string' ? data.version : undefined
  const author = typeof data.author === 'string' ? data.author : undefined

  logger.debug('Successfully parsed skill metadata', {
    skillFolderPath,
    folderName,
    size: folderSize
  })

  return {
    sourcePath, // e.g., "skills/my-skill"
    filename: folderName, // e.g., "my-skill" (folder name, NO .md extension)
    name,
    description,
    tools,
    category, // "skills" for flat structure
    type: 'skill',
    tags,
    version,
    author,
    size: folderSize,
    contentHash // Hash of SKILL.md content only
  }
}
