import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'

import { MAX_FILES_LIMIT, validatePath } from '../types'

// Schema definition
export const LsToolSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('The directory to list. If not specified, the current working directory will be used'),
  recursive: z.boolean().optional().describe('Whether to list directories recursively (default: false)')
})

// Tool definition with detailed description
export const lsToolDefinition = {
  name: 'ls',
  description: `List files and directories in a specified path.

- Returns a tree-like structure showing the directory contents with icons
- Directories are shown with 📁, files with 📄
- Entries are sorted alphabetically with directories first
- Can optionally list recursively to show subdirectories (up to 5 levels deep)
- Common directories like node_modules, dist, .git are automatically excluded
- Hidden files (starting with .) are excluded except .env.example
- Results are limited to 100 entries to avoid overwhelming output
- If path is not specified, lists the current working directory`,
  inputSchema: z.toJSONSchema(LsToolSchema)
}

// Handler implementation
export async function handleLsTool(args: unknown, allowedDirectories: string[]) {
  const parsed = LsToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for ls: ${parsed.error}`)
  }

  const targetPath = parsed.data.path || process.cwd()
  const validPath = await validatePath(allowedDirectories, targetPath)
  const recursive = parsed.data.recursive || false

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
          // Limit depth to prevent infinite recursion
          const childPath = path.join(dirPath, entry.name)
          node.children = await buildTree(childPath, depth + 1)
        }

        nodes.push(node)
      }

      return nodes
    } catch (error) {
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
