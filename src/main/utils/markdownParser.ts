import { loggerService } from '@logger'
import type { PluginError, PluginMetadata } from '@types'
import * as crypto from 'crypto'
import * as fs from 'fs'
import matter from 'gray-matter'
import * as path from 'path'
import { parse } from 'yaml'

import { getDirectorySize } from './fileOperations'

const logger = loggerService.withContext('Utils:MarkdownParser')

const YAML_PARSE_OPTIONS = { schema: 'failsafe' as const }

// Skill markdown filename variants (case-insensitive support)
const SKILL_MD_VARIANTS = ['SKILL.md', 'skill.md']

/**
 * Find the skill markdown file in a directory (supports SKILL.md or skill.md)
 * @returns The full path to the skill file if found, null otherwise
 */
export async function findSkillMdPath(dirPath: string): Promise<string | null> {
  for (const variant of SKILL_MD_VARIANTS) {
    const skillMdPath = path.join(dirPath, variant)
    try {
      await fs.promises.stat(skillMdPath)
      return skillMdPath
    } catch {
      // Try next variant
    }
  }
  return null
}

/**
 * Check if a directory entry is a directory or a symlink pointing to a directory
 * Follows symlinks to determine if they point to valid directories
 */
async function isDirectoryOrSymlinkToDirectory(entry: fs.Dirent, parentDir: string): Promise<boolean> {
  if (entry.isDirectory()) {
    return true
  }
  if (entry.isSymbolicLink()) {
    try {
      const fullPath = path.join(parentDir, entry.name)
      const stats = await fs.promises.stat(fullPath) // stat follows symlinks
      return stats.isDirectory()
    } catch {
      // Broken symlink or permission error
      return false
    }
  }
  return false
}

type FrontmatterContext = {
  filePath?: string
  skillMdPath?: string
}

const isString = (value: unknown): value is string => typeof value === 'string'

function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter(isString)
  }
  if (isString(value)) {
    return value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }
  return undefined
}

function toString(value: unknown): string | undefined {
  return isString(value) ? value : undefined
}

function parseLooseValue(raw: string): unknown {
  if (!raw) return ''
  try {
    const parsed = parse(raw, YAML_PARSE_OPTIONS)
    return parsed === undefined ? raw : parsed
  } catch {
    return raw
  }
}

function parseFrontmatterLoose(content: string): Record<string, unknown> {
  const lines = content.split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return {}
  }

  let endIndex = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIndex = i
      break
    }
  }
  if (endIndex === -1) {
    return {}
  }

  const frontmatterLines = lines.slice(1, endIndex)
  const data: Record<string, unknown> = {}
  let currentKey: string | null = null
  let buffer: string[] = []

  const flush = () => {
    if (!currentKey) return
    const rawValue = buffer.join('\n').trim()
    data[currentKey] = parseLooseValue(rawValue)
    buffer = []
    currentKey = null
  }

  for (const line of frontmatterLines) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:(.*)$/)
    if (keyMatch) {
      flush()
      currentKey = keyMatch[1]
      const rest = keyMatch[2].trimStart()
      if (rest.length > 0) {
        data[currentKey] = parseLooseValue(rest)
        currentKey = null
      }
      continue
    }
    if (currentKey) {
      buffer.push(line)
    }
  }

  flush()
  return data
}

function recoverFrontmatter(content: string, context: FrontmatterContext): Record<string, unknown> {
  const data = parseFrontmatterLoose(content)
  logger.warn('Recovered frontmatter using loose parser', {
    ...context,
    keys: Object.keys(data)
  })
  return data
}

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
  let data: Record<string, unknown> = {}
  try {
    const parsed = matter(content, {
      engines: {
        yaml: (s) => parse(s, YAML_PARSE_OPTIONS) as object
      }
    })
    data = (parsed.data ?? {}) as Record<string, unknown>
  } catch (error: any) {
    logger.warn('Failed to parse plugin frontmatter, attempting recovery', {
      filePath,
      error: error?.message || String(error)
    })
    data = recoverFrontmatter(content, { filePath })
  }

  // Calculate content hash for integrity checking
  const contentHash = crypto.createHash('sha256').update(content).digest('hex')

  // Extract filename
  const filename = path.basename(filePath)

  // Parse allowed_tools - handle both array and comma-separated string
  const allowedTools = toStringArray(data['allowed-tools'] ?? data.allowed_tools)

  // Parse tools - similar handling
  const tools = toStringArray(data.tools)

  // Parse tags
  const tags = toStringArray(data.tags)

  const name = toString(data.name) ?? filename.replace(/\.md$/, '')
  const description = toString(data.description)
  const version = toString(data.version)
  const author = toString(data.author)

  return {
    sourcePath,
    filename,
    name,
    description,
    allowed_tools: allowedTools,
    tools,
    category,
    type,
    tags,
    version,
    author,
    size: stats.size,
    contentHash
  }
}

/**
 * Recursively find all directories containing SKILL.md or skill.md
 * Supports symlinks and deduplicates by skill name
 *
 * @param dirPath - Directory to search in
 * @param basePath - Base path for calculating relative source paths
 * @param maxDepth - Maximum depth to search (default: 10 to prevent infinite loops)
 * @param currentDepth - Current search depth (used internally)
 * @param seen - Set of already seen skill names (for deduplication)
 * @returns Array of objects with absolute folder path and relative source path
 */
export async function findAllSkillDirectories(
  dirPath: string,
  basePath: string,
  maxDepth = 10,
  currentDepth = 0,
  seen: Set<string> = new Set()
): Promise<Array<{ folderPath: string; sourcePath: string }>> {
  const results: Array<{ folderPath: string; sourcePath: string }> = []

  // Prevent excessive recursion
  if (currentDepth > maxDepth) {
    return results
  }

  // Check if current directory contains SKILL.md or skill.md
  const skillMdPath = await findSkillMdPath(dirPath)

  if (skillMdPath) {
    // Found skill markdown in this directory
    const skillName = path.basename(dirPath)

    // Deduplicate: only add if we haven't seen this skill name yet
    if (!seen.has(skillName)) {
      seen.add(skillName)
      const relativePath = path.relative(basePath, dirPath)
      results.push({
        folderPath: dirPath,
        sourcePath: relativePath
      })
    }
    return results
  }

  // Only search subdirectories if current directory doesn't have SKILL.md
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      // Support both directories and symlinks pointing to directories
      if (await isDirectoryOrSymlinkToDirectory(entry, dirPath)) {
        const subDirPath = path.join(dirPath, entry.name)
        const subResults = await findAllSkillDirectories(subDirPath, basePath, maxDepth, currentDepth + 1, seen)
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

  // Look for SKILL.md or skill.md directly in this folder (no recursion)
  const skillMdPath = await findSkillMdPath(skillFolderPath)

  // Check if skill markdown exists
  if (!skillMdPath) {
    logger.error('SKILL.md or skill.md not found in skill folder', { skillFolderPath })
    throw {
      type: 'FILE_NOT_FOUND',
      path: path.join(skillFolderPath, 'SKILL.md'),
      message: 'SKILL.md or skill.md not found in skill folder'
    } as PluginError
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
  let data: Record<string, unknown> = {}
  try {
    const parsed = matter(content, {
      engines: {
        yaml: (s) => parse(s, YAML_PARSE_OPTIONS) as object
      }
    })
    data = (parsed.data ?? {}) as Record<string, unknown>
  } catch (error: any) {
    logger.warn('Failed to parse SKILL.md frontmatter, attempting recovery', {
      skillMdPath,
      error: error?.message || String(error)
    })
    data = recoverFrontmatter(content, { skillMdPath })
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
  const tools = toStringArray(data.tools)

  // Parse tags
  const tags = toStringArray(data.tags)

  // Validate and sanitize name
  const rawName = toString(data.name)
  const name = rawName && rawName.trim() ? rawName.trim() : folderName

  // Validate and sanitize description
  const rawDescription = toString(data.description)
  const description = rawDescription && rawDescription.trim() ? rawDescription.trim() : undefined

  // Validate version and author
  const version = toString(data.version)
  const author = toString(data.author)

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
