import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'

import type { FileInfo } from '../types'
import { logger, MAX_FILES_LIMIT, runRipgrep, validatePath } from '../types'

// Schema definition
export const GlobToolSchema = z.object({
  pattern: z.string().describe('The glob pattern to match files against'),
  path: z
    .string()
    .optional()
    .describe('The directory to search in (must be absolute path). Defaults to the base directory')
})

// Tool definition with detailed description
export const globToolDefinition = {
  name: 'glob',
  description: `Fast file pattern matching tool that works with any codebase size.

- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching absolute file paths sorted by modification time (newest first)
- Use this when you need to find files by name patterns
- Patterns: * (any chars), ** (recursive), {a,b} (alternatives), ? (single char)
- Results are limited to 100 files
- The path parameter must be an absolute path if specified
- If path is not specified, defaults to the base directory
- IMPORTANT: Omit the path field for the default directory (don't use "undefined" or "null")`,
  inputSchema: z.toJSONSchema(GlobToolSchema)
}

// Maximum recursion depth to prevent stack overflow
const MAX_RECURSION_DEPTH = 50

// Handler implementation
export async function handleGlobTool(args: unknown, baseDir: string) {
  const parsed = GlobToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for glob: ${parsed.error}`)
  }

  const searchPath = parsed.data.path || baseDir
  const validPath = await validatePath(searchPath, baseDir)

  // Verify the search directory exists
  try {
    const stats = await fs.stat(validPath)
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${validPath}`)
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Directory not found: ${validPath}`)
    }
    throw error
  }

  // Validate and normalize pattern
  let pattern = parsed.data.pattern.trim()
  if (!pattern) {
    throw new Error('Pattern cannot be empty')
  }

  // Normalize pattern: simple patterns like "*.md" need "**/*.md" for recursive matching
  // Patterns with paths like "src/*.ts" are kept as-is
  if (!pattern.includes('/') && !pattern.startsWith('**')) {
    pattern = `**/${pattern}`
  }

  const files: FileInfo[] = []
  let truncated = false
  let ripgrepSucceeded = false

  // Build ripgrep arguments for file listing using --glob=pattern format
  const rgArgs: string[] = [
    '--files',
    '--follow',
    '--hidden',
    `--glob=${pattern}`,
    '--glob=!.git/*',
    '--glob=!node_modules/*',
    '--glob=!dist/*',
    '--glob=!build/*',
    '--glob=!__pycache__/*',
    validPath
  ]

  // Try embedded ripgrep for file listing
  try {
    const rgResult = await runRipgrep(rgArgs)
    // exitCode 0 = matches found, exitCode 1 = no matches, exitCode 2 = error
    if (rgResult.ok && rgResult.exitCode !== null && (rgResult.exitCode === 0 || rgResult.exitCode === 1)) {
      ripgrepSucceeded = true
      const lines = rgResult.stdout.split('\n').filter(Boolean)

      for (const line of lines) {
        if (files.length >= MAX_FILES_LIMIT) {
          truncated = true
          break
        }

        const filePath = line.trim()
        if (!filePath) continue

        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(validPath, filePath)

        try {
          const stats = await fs.stat(absolutePath)
          files.push({
            path: absolutePath,
            type: 'file', // ripgrep --files only returns files
            size: stats.size,
            modified: stats.mtime
          })
        } catch (error) {
          logger.debug('Failed to stat file from ripgrep output, skipping', { file: absolutePath, error })
        }
      }
    }
  } catch (error) {
    logger.debug('Ripgrep failed, using fallback', { error, pattern, validPath })
  }

  // Fallback to recursive directory listing if ripgrep failed
  if (!ripgrepSucceeded) {
    async function listFilesRecursive(dir: string, depth = 0): Promise<void> {
      if (depth > MAX_RECURSION_DEPTH) {
        logger.warn('Maximum recursion depth reached', { dir, depth })
        return
      }

      if (files.length >= MAX_FILES_LIMIT) {
        truncated = true
        return
      }

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (files.length >= MAX_FILES_LIMIT) {
            truncated = true
            break
          }

          // Skip common ignore patterns
          if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
          if (['node_modules', 'dist', 'build', '__pycache__'].includes(entry.name)) continue

          const fullPath = path.join(dir, entry.name)

          if (entry.isDirectory()) {
            await listFilesRecursive(fullPath, depth + 1)
          } else {
            // Normalize path separators for consistent matching
            const relativePath = path.relative(validPath, fullPath).replace(/\\/g, '/')
            if (matchesPattern(relativePath, pattern)) {
              try {
                const stats = await fs.stat(fullPath)
                files.push({
                  path: fullPath,
                  type: 'file',
                  size: stats.size,
                  modified: stats.mtime
                })
              } catch (error) {
                logger.debug('Failed to stat file, skipping', { file: fullPath, error })
              }
            }
          }
        }
      } catch (error) {
        logger.debug('Failed to read directory, skipping', { dir, error })
      }
    }

    await listFilesRecursive(validPath)
  }

  // Sort by modification time (newest first)
  files.sort((a, b) => {
    const aTime = a.modified ? a.modified.getTime() : 0
    const bTime = b.modified ? b.modified.getTime() : 0
    return bTime - aTime
  })

  // Format output - always use absolute paths
  const output: string[] = []
  if (files.length === 0) {
    output.push(`No files found matching pattern "${parsed.data.pattern}" in ${validPath}`)
  } else {
    output.push(...files.map((f) => f.path))
    if (truncated) {
      output.push('')
      output.push(`(Results truncated to ${MAX_FILES_LIMIT} files. Consider using a more specific pattern.)`)
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: output.join('\n')
      }
    ]
  }
}

/**
 * Simple glob pattern matching for fallback mode
 * Supports: * (any chars), ** (recursive), ? (single char), {a,b} (alternatives)
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/')
  const normalizedPattern = pattern.replace(/\\/g, '/')

  // Convert glob pattern to regex, escaping special regex characters first
  const regexPattern = normalizedPattern
    .replace(/[+^$|()[\]{}]/g, '\\$&') // Escape regex special chars (except glob metacharacters)
    .replace(/\./g, '\\.') // Escape dots
    .replace(/\*\*/g, '{{GLOBSTAR}}') // Temp placeholder for **
    .replace(/\*/g, '[^/]*') // * matches anything except /
    .replace(/\?/g, '[^/]') // ? matches single char except /
    .replace(/{{GLOBSTAR}}/g, '.*') // ** matches anything including /
    .replace(/\\{([^}]+)\\}/g, (_, group) => {
      // Handle {a,b} alternatives - the braces were escaped, so we need to handle \\{ and \\}
      const alternatives = group.split(',').map((alt: string) => alt.trim())
      return `(${alternatives.join('|')})`
    })

  try {
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(normalizedPath)
  } catch {
    return false
  }
}
