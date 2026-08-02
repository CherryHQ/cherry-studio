import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

import matter from 'gray-matter'
import { parse } from 'yaml'

import { loggerService } from '@logger'
import type { PluginMetadata } from '@main/utils/plugin'

import { getDirectorySize } from './fileOperations'

const logger = loggerService.withContext('Utils:MarkdownParser')

export type PluginErrorType = 'FILE_NOT_FOUND' | 'INVALID_METADATA' | 'READ_FAILED'

export class PluginError extends Error {
  constructor(
    readonly type: PluginErrorType,
    readonly path: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'PluginError'
  }
}

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
    data = parsed.data ?? {}
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
 * Supports symlinks and preserves every matching directory.
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

  // Check if current directory contains SKILL.md or skill.md
  const skillMdPath = await findSkillMdPath(dirPath)

  if (skillMdPath) {
    const relativePath = path.relative(basePath, dirPath)
    results.push({
      folderPath: dirPath,
      sourcePath: relativePath
    })
    return results
  }

  // Only search subdirectories if current directory doesn't have SKILL.md
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      // Support both directories and symlinks pointing to directories
      if (await isDirectoryOrSymlinkToDirectory(entry, dirPath)) {
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
  category: string,
  options: { calculateSize?: boolean } = {}
): Promise<PluginMetadata> {
  // Input validation
  if (!skillFolderPath || !path.isAbsolute(skillFolderPath)) {
    throw new PluginError('INVALID_METADATA', skillFolderPath, 'Skill folder path must be absolute')
  }

  // Look for SKILL.md or skill.md directly in this folder (no recursion)
  const skillMdPath = await findSkillMdPath(skillFolderPath)

  // Check if skill markdown exists
  if (!skillMdPath) {
    logger.error('SKILL.md or skill.md not found in skill folder', { skillFolderPath })
    throw new PluginError(
      'FILE_NOT_FOUND',
      path.join(skillFolderPath, 'SKILL.md'),
      'SKILL.md or skill.md not found in skill folder'
    )
  }

  // Read SKILL.md content
  let content: string
  try {
    content = await fs.promises.readFile(skillMdPath, 'utf8')
  } catch (error) {
    logger.error('Failed to read SKILL.md', { skillMdPath, error })
    throw new PluginError('READ_FAILED', skillMdPath, error instanceof Error ? error.message : 'Unknown error', {
      cause: error
    })
  }

  // Parse frontmatter safely with FAILSAFE_SCHEMA to prevent deserialization attacks
  let data: Record<string, unknown> = {}
  try {
    const parsed = matter(content, {
      engines: {
        yaml: (s) => parse(s, YAML_PARSE_OPTIONS) as object
      }
    })
    data = parsed.data ?? {}
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
  let folderSize = 0
  if (options.calculateSize !== false) {
    try {
      folderSize = await getDirectorySize(skillFolderPath)
    } catch (error: any) {
      logger.error('Failed to calculate skill folder size', { skillFolderPath, error })
    }
  }

  // Parse tools (skills use 'tools', not 'allowed_tools')
  const tools = toStringArray(data.tools)

  // Parse tags
  const tags = toStringArray(data.tags)

  // Validate and sanitize name
  const rawName = toString(data.name)
  const name = rawName && rawName.trim() ? rawName.trim() : folderName
  const slug = toString(data.slug)

  // Validate and sanitize description
  const rawDescription = toString(data.description)
  const description = rawDescription && rawDescription.trim() ? rawDescription.trim() : undefined

  // Validate version and author
  const nestedMetadata =
    typeof data.metadata === 'object' && data.metadata !== null && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : undefined
  const version = toString(data.version) ?? toString(nestedMetadata?.version)
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
    slug,
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
