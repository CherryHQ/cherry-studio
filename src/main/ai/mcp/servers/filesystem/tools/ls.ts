import fs from 'fs/promises'
import path from 'path'

import type { CallToolResult } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { logger, MAX_FILES_LIMIT, validatePath } from '../types'

// Schema definition
export const LsToolSchema = z.object({
  path: z.string().optional().describe('The directory to list (must be absolute path). Defaults to the base directory'),
  recursive: z.boolean().optional().describe('Whether to list directories recursively (default: false)')
})

// Tool definition with detailed description
export const lsToolDefinition = {
  description: `Lists files and directories in a specified path.

- Returns a tree-like structure with icons (📁 directories, 📄 files)
- Shows the absolute directory path in the header
- Entries are sorted alphabetically with directories first
- Can list recursively with recursive=true (up to 5 levels deep)
- Common directories (node_modules, dist, .git) are excluded
- Hidden files (starting with .) are excluded except .env.example
- Results are limited to 100 entries
- The path parameter must resolve within the configured workspace root if specified
- If path is not specified, defaults to the base directory`,
  inputSchema: LsToolSchema
}

// Handler implementation
export async function handleLsTool(args: z.infer<typeof LsToolSchema>, baseDir: string): Promise<CallToolResult> {
  const targetPath = args.path || baseDir
  const validPath = await validatePath(targetPath, baseDir)

  // Verify the target exists and is a directory before walking it: the recursive
  // walk below treats an unreadable directory as empty, so without this check a
  // missing or non-directory path is reported as "(empty directory)" instead of
  // the real error. Same contract `glob` and `read` apply to their targets.
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

  const recursive = args.recursive || false

  interface TreeNode {
    name: string
    type: 'file' | 'directory'
    children?: TreeNode[]
  }

  let fileCount = 0
  let truncated = false

  async function buildTree(dirPath: string, depth: number = 0): Promise<TreeNode[]> {
    if (fileCount >= MAX_FILES_LIMIT) {
      truncated = true
      return []
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const nodes: TreeNode[] = []

      // Sort entries: directories first, then files, alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })

      for (const entry of entries) {
        if (fileCount >= MAX_FILES_LIMIT) {
          truncated = true
          break
        }

        // Skip hidden files and common ignore patterns
        if (entry.name.startsWith('.') && entry.name !== '.env.example') {
          continue
        }
        if (['node_modules', 'dist', 'build', '__pycache__'].includes(entry.name)) {
          continue
        }

        fileCount++
        const node: TreeNode = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        }

        if (entry.isDirectory() && recursive && depth < 5) {
          const childPath = path.join(dirPath, entry.name)
          // Validate symlinked directories to prevent escaping the workspace root
          try {
            await validatePath(childPath, baseDir)
            node.children = await buildTree(childPath, depth + 1)
          } catch {
            logger.debug('Skipping directory outside workspace root', { path: childPath })
          }
        }

        nodes.push(node)
      }

      return nodes
    } catch (error: unknown) {
      // A subdirectory that cannot be listed is skipped so one unreadable folder
      // does not abort the whole tree, but the root was verified above, so
      // reaching this point at depth 0 means the listing failed for a real
      // reason (e.g. permissions) and must not read as an empty directory.
      if (depth === 0) {
        throw error
      }
      logger.debug('Skipping unreadable directory', { path: dirPath })
      return []
    }
  }

  // Build the tree
  const tree = await buildTree(validPath)

  // Format as text output
  function formatTree(nodes: TreeNode[], prefix: string = ''): string[] {
    const lines: string[] = []

    nodes.forEach((node, index) => {
      const isLastNode = index === nodes.length - 1
      const connector = isLastNode ? '└── ' : '├── '
      const icon = node.type === 'directory' ? '📁 ' : '📄 '

      lines.push(prefix + connector + icon + node.name)

      if (node.children && node.children.length > 0) {
        const childPrefix = prefix + (isLastNode ? '    ' : '│   ')
        lines.push(...formatTree(node.children, childPrefix))
      }
    })

    return lines
  }

  // Generate output
  const output: string[] = []
  output.push(`Directory: ${validPath}`)
  output.push('')

  if (tree.length === 0) {
    output.push('(empty directory)')
  } else {
    const treeLines = formatTree(tree, '')
    output.push(...treeLines)

    if (truncated) {
      output.push('')
      output.push(`(Results truncated to ${MAX_FILES_LIMIT} files. Consider listing a more specific directory.)`)
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
