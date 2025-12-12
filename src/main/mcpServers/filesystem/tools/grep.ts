import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'

import type { GrepMatch } from '../types'
import { isBinaryFile, MAX_GREP_MATCHES, MAX_LINE_LENGTH, validatePath } from '../types'

// Schema definition
export const GrepToolSchema = z.object({
  pattern: z.string().describe('The regex pattern to search for in file contents'),
  path: z.string().optional().describe('The directory to search in. Defaults to the current working directory'),
  include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")')
})

// Tool definition with detailed description
export const grepToolDefinition = {
  name: 'grep',
  description: `Fast content search tool that works with any codebase size.

- Searches file contents using regular expressions
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files by pattern with the include parameter (e.g., "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with matching content sorted by file
- Use this tool when you need to find files containing specific patterns
- Results are limited to 100 matches to avoid overwhelming output
- Binary files are automatically skipped
- Common directories like node_modules, .git, dist are excluded`,
  inputSchema: z.toJSONSchema(GrepToolSchema)
}

// Handler implementation
export async function handleGrepTool(args: unknown, allowedDirectories: string[]) {
  const parsed = GrepToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for grep: ${parsed.error}`)
  }

  if (!parsed.data.pattern) {
    throw new Error('Pattern is required for grep')
  }

  const searchPath = parsed.data.path || process.cwd()
  const validPath = await validatePath(allowedDirectories, searchPath)

  const matches: GrepMatch[] = []
  let truncated = false
  let regex: RegExp

  try {
    regex = new RegExp(parsed.data.pattern, 'gi')
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${parsed.data.pattern}`)
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
          if (parsed.data?.include) {
            const includePatterns = parsed.data.include.split(',').map((p) => p.trim())
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
  const stats = await fs.stat(validPath)
  if (stats.isFile()) {
    await searchFile(validPath)
  } else {
    await searchDirectory(validPath)
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

    // Format grouped matches
    fileGroups.forEach((fileMatches, filePath) => {
      const relativePath = path.relative(process.cwd(), filePath)
      output.push(`\n${relativePath}:`)
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
