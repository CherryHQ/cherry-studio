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
- Patterns without "/" (e.g., "*.txt") match files at ANY depth in the directory tree
- Patterns with "/" (e.g., "src/*.ts") match relative to the search path
- Pattern syntax: * (any chars), ** (any path), {a,b} (alternatives), ? (single char)
- Results are limited to 100 files
- The path parameter must be an absolute path if specified
- If path is not specified, defaults to the base directory
- IMPORTANT: Omit the path field for the default directory (don't use "undefined" or "null")`,
  inputSchema: z.toJSONSchema(GlobToolSchema)
}

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

  // Validate pattern
  const pattern = parsed.data.pattern.trim()
  if (!pattern) {
    throw new Error('Pattern cannot be empty')
  }

  const files: FileInfo[] = []
  let truncated = false

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

  // Use ripgrep for file listing
  logger.debug('Running ripgrep with args', { rgArgs })
  const rgResult = await runRipgrep(rgArgs)
  logger.debug('Ripgrep result', {
    ok: rgResult.ok,
    exitCode: rgResult.exitCode,
    stdoutLength: rgResult.stdout.length,
    stdoutPreview: rgResult.stdout.slice(0, 500)
  })

  // Process results if we have stdout content
  // Exit code 2 can indicate partial errors (e.g., permission denied on some dirs) but still have valid results
  if (rgResult.ok && rgResult.stdout.length > 0) {
    const lines = rgResult.stdout.split('\n').filter(Boolean)
    logger.debug('Parsed lines from ripgrep', { lineCount: lines.length, lines })

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
