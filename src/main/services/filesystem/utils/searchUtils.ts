import fs from 'fs/promises'
import { minimatch } from 'minimatch'
import path from 'path'

import { validatePath } from './pathValidation'

export async function searchFiles(
  allowedDirectories: string[],
  rootPath: string,
  pattern: string,
  excludePatterns: string[] = []
): Promise<string[]> {
  const results: string[] = []

  async function search(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)

      try {
        // Validate each path before processing
        await validatePath(allowedDirectories, fullPath)

        // Check if path matches any exclude pattern
        const relativePath = path.relative(rootPath, fullPath)
        const shouldExclude = excludePatterns.some((pattern) => {
          const globPattern = pattern.includes('*') ? pattern : `**/${pattern}/**`
          return minimatch(relativePath, globPattern, { dot: true })
        })

        if (shouldExclude) {
          continue
        }

        if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
          results.push(fullPath)
        }

        if (entry.isDirectory()) {
          await search(fullPath)
        }
      } catch (error) {
        // Skip invalid paths during search
      }
    }
  }

  await search(rootPath)
  return results
}

// Prepare for ripgrep integration
export interface CodeSearchOptions {
  path: string
  pattern: string
  filePattern?: string
  excludePatterns?: string[]
  contextLines?: number
}

export async function searchCode(options: CodeSearchOptions): Promise<
  Array<{
    file: string
    line: number
    content: string
    match: string
  }>
> {
  // This is a placeholder for ripgrep integration
  // For now, implement a simple grep-like search
  const results: Array<{ file: string; line: number; content: string; match: string }> = []

  // TODO: Integrate with @vscode/ripgrep for better performance
  // For now, use a simple implementation
  const files = await searchFiles([], options.path, options.filePattern || '', options.excludePatterns || [])

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8')
      const lines = content.split('\n')

      lines.forEach((line, index) => {
        if (line.includes(options.pattern)) {
          results.push({
            file,
            line: index + 1,
            content: line.trim(),
            match: options.pattern
          })
        }
      })
    } catch (error) {
      // Skip files that can't be read
    }
  }

  return results
}
