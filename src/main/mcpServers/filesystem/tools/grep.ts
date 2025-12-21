import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'

import type { GrepMatch } from '../types'
import { isBinaryFile, MAX_GREP_MATCHES, MAX_LINE_LENGTH, runRipgrep, validatePath } from '../types'

// Schema definition
export const GrepToolSchema = z.object({
  pattern: z.string().describe('The regex pattern to search for in file contents'),
  path: z
    .string()
    .optional()
    .describe('The directory to search in (must be absolute path). Defaults to the base directory'),
  include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")')
})

// Tool definition with detailed description
export const grepToolDefinition = {
  name: 'grep',
  description: `Fast content search tool that works with any codebase size.

- Searches file contents using regular expressions
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files by pattern with include (e.g., "*.js", "*.{ts,tsx}")
- Returns absolute file paths and line numbers with matching content
- Results are limited to 100 matches
- Binary files are automatically skipped
- Common directories (node_modules, .git, dist) are excluded
- The path parameter must be an absolute path if specified
- If path is not specified, defaults to the base directory`,
  inputSchema: z.toJSONSchema(GrepToolSchema)
}

// Handler implementation
export async function handleGrepTool(args: unknown, baseDir: string) {
  const parsed = GrepToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for grep: ${parsed.error}`)
  }

  const data = parsed.data

  if (!data.pattern) {
    throw new Error('Pattern is required for grep')
  }

  const searchPath = data.path || baseDir
  const validPath = await validatePath(searchPath, baseDir)

  const matches: GrepMatch[] = []
  let truncated = false
  let regex: RegExp

  // Build ripgrep arguments
  const rgArgs: string[] = [
    '--no-heading',
    '--line-number',
    '--color',
    'never',
    '--ignore-case',
    '--glob',
    '!.git/**',
    '--glob',
    '!node_modules/**',
    '--glob',
    '!dist/**',
    '--glob',
    '!build/**',
    '--glob',
    '!__pycache__/**'
  ]

  if (data.include) {
    for (const pat of data.include
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)) {
      rgArgs.push('--glob', pat)
    }
  }

  rgArgs.push(data.pattern)
  rgArgs.push(validPath)

  try {
    regex = new RegExp(data.pattern, 'gi')
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${data.pattern}`)
  }

  async function searchFile(filePath: string): Promise<void> {
    if (matches.length >= MAX_GREP_MATCHES) {
      truncated = true
      return
    }

    try {
      // Skip binary files
      if (await isBinaryFile(filePath)) {
        return
      }

      const content = await fs.readFile(filePath, 'utf-8')
      const lines = content.split('\n')

      lines.forEach((line, index) => {
        if (matches.length >= MAX_GREP_MATCHES) {
          truncated = true
          return
        }

        if (regex.test(line)) {
          // Truncate long lines
          const truncatedLine = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + '...' : line

          matches.push({
            file: filePath,
            line: index + 1,
            content: truncatedLine.trim()
          })
        }
      })
    } catch (error) {
      // Skip files we can't read
    }
  }

  async function searchDirectory(dir: string): Promise<void> {
    if (matches.length >= MAX_GREP_MATCHES) {
      truncated = true
      return
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (matches.length >= MAX_GREP_MATCHES) {
          truncated = true
          break
        }

        const fullPath = path.join(dir, entry.name)

        // Skip common ignore patterns
        if (entry.name.startsWith('.') && entry.name !== '.env.example') {
          continue
        }
        if (['node_modules', 'dist', 'build', '__pycache__', '.git'].includes(entry.name)) {
          continue
        }

        if (entry.isFile()) {
          // Check if file matches include pattern
          if (data.include) {
            const includePatterns = data.include.split(',').map((p) => p.trim())
            const fileName = path.basename(fullPath)
            const matchesInclude = includePatterns.some((pattern) => {
              // Simple glob pattern matching
              const regexPattern = pattern
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.')
                .replace(/\{([^}]+)\}/g, (_, group) => `(${group.split(',').join('|')})`)
              return new RegExp(`^${regexPattern}$`).test(fileName)
            })
            if (!matchesInclude) {
              continue
            }
          }

          await searchFile(fullPath)
        } else if (entry.isDirectory()) {
          await searchDirectory(fullPath)
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  // Perform the search
  let usedRipgrep = false
  try {
    const rgResult = await runRipgrep(rgArgs)
    if (rgResult.ok && rgResult.exitCode !== null && rgResult.exitCode !== 2) {
      usedRipgrep = true
      const lines = rgResult.stdout.split('\n').filter(Boolean)
      for (const line of lines) {
        if (matches.length >= MAX_GREP_MATCHES) {
          truncated = true
          break
        }

        const firstColon = line.indexOf(':')
        const secondColon = line.indexOf(':', firstColon + 1)
        if (firstColon === -1 || secondColon === -1) continue

        const filePart = line.slice(0, firstColon)
        const linePart = line.slice(firstColon + 1, secondColon)
        const contentPart = line.slice(secondColon + 1)
        const lineNum = Number.parseInt(linePart, 10)
        if (!Number.isFinite(lineNum)) continue

        const absoluteFilePath = path.isAbsolute(filePart) ? filePart : path.resolve(baseDir, filePart)
        const truncatedLine =
          contentPart.length > MAX_LINE_LENGTH ? contentPart.substring(0, MAX_LINE_LENGTH) + '...' : contentPart

        matches.push({
          file: absoluteFilePath,
          line: lineNum,
          content: truncatedLine.trim()
        })
      }
    }
  } catch {
    usedRipgrep = false
  }

  if (!usedRipgrep) {
    const stats = await fs.stat(validPath)
    if (stats.isFile()) {
      await searchFile(validPath)
    } else {
      await searchDirectory(validPath)
    }
  }

  // Format output
  const output: string[] = []

  if (matches.length === 0) {
    output.push('No matches found')
  } else {
    // Group matches by file
    const fileGroups = new Map<string, GrepMatch[]>()
    matches.forEach((match) => {
      if (!fileGroups.has(match.file)) {
        fileGroups.set(match.file, [])
      }
      fileGroups.get(match.file)!.push(match)
    })

    // Format grouped matches - always use absolute paths
    fileGroups.forEach((fileMatches, filePath) => {
      output.push(`\n${filePath}:`)
      fileMatches.forEach((match) => {
        output.push(`  ${match.line}: ${match.content}`)
      })
    })

    if (truncated) {
      output.push('')
      output.push(`(Results truncated to ${MAX_GREP_MATCHES} matches. Consider using a more specific pattern or path.)`)
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
