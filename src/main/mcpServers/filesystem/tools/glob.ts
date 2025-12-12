import fs from 'fs/promises'
import { minimatch } from 'minimatch'
import path from 'path'
import * as z from 'zod'

import type { FileInfo } from '../types'
import { MAX_FILES_LIMIT, validatePath } from '../types'

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

// Handler implementation
export async function handleGlobTool(args: unknown, baseDir: string) {
  const parsed = GlobToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for glob: ${parsed.error}`)
  }

  const searchPath = parsed.data.path || baseDir
  const validPath = await validatePath(searchPath, baseDir)

  const files: FileInfo[] = []
  let truncated = false

  async function searchDirectory(dir: string, pattern: string): Promise<void> {
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

        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(validPath, fullPath)

        // Check if file matches pattern
        if (minimatch(relativePath, pattern, { dot: true })) {
          const stats = await fs.stat(fullPath)
          files.push({
            path: fullPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modified: stats.mtime
          })
        }

        // Recursively search directories if pattern includes **
        if (entry.isDirectory() && (pattern.includes('**') || pattern.includes('/'))) {
          await searchDirectory(fullPath, pattern)
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  await searchDirectory(validPath, parsed.data.pattern)

  // Sort by modification time (newest first)
  files.sort((a, b) => {
    const aTime = a.modified?.getTime() || 0
    const bTime = b.modified?.getTime() || 0
    return bTime - aTime
  })

  // Format output - always use absolute paths
  const output: string[] = []
  if (files.length === 0) {
    output.push('No files found matching pattern')
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
