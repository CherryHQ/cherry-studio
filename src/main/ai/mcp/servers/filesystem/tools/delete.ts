import { unlink } from 'node:fs/promises'
import path from 'path'

import type { CallToolResult } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { removeDir, stat } from '@main/utils/file'

import { filesystemMutationService } from '../FilesystemMutationService'
import { logger } from '../types'

// Schema definition
export const DeleteToolSchema = z.object({
  path: z.string().describe('The path to the file or directory to delete'),
  recursive: z.boolean().optional().describe('For directories, whether to delete recursively (default: false)')
})

// Tool definition with detailed description
export const deleteToolDefinition = {
  description: `Deletes a file or directory from the filesystem.

CAUTION: This operation cannot be undone!

- For files: simply provide the path
- For empty directories: provide the path
- For non-empty directories: set recursive=true
- The path must resolve within the configured workspace root
- Always verify the path before deleting to avoid data loss`,
  inputSchema: DeleteToolSchema
}

// Handler implementation
export async function handleDeleteTool(
  args: z.infer<typeof DeleteToolSchema>,
  baseDir: string
): Promise<CallToolResult> {
  const targetPath = args.path
  const recursive = args.recursive || false

  return filesystemMutationService.runExclusive(
    targetPath,
    baseDir,
    async (validPath) => {
      // Check if path exists and get stats
      let stats
      try {
        stats = await stat(validPath)
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          throw new Error(`Path not found: ${targetPath}`)
        }
        throw error
      }

      const isDirectory = stats.isDirectory
      const relativePath = path.relative(baseDir, validPath)

      // Perform deletion
      try {
        if (isDirectory) {
          await removeDir(validPath, { recursive })
        } else {
          await unlink(validPath)
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          throw new Error(`Path not found: ${targetPath}`)
        }
        if (error.code === 'ENOTEMPTY') {
          throw new Error(`Directory not empty: ${targetPath}. Use recursive=true to delete non-empty directories.`)
        }
        throw new Error(`Failed to delete: ${error.message}`)
      }

      // Log the operation
      logger.info('Path deleted', {
        path: validPath,
        type: isDirectory ? 'directory' : 'file',
        recursive: isDirectory ? recursive : undefined
      })

      // Format output
      const itemType = isDirectory ? 'Directory' : 'File'
      const recursiveNote = isDirectory && recursive ? ' (recursive)' : ''

      return {
        content: [
          {
            type: 'text',
            text: `${itemType} deleted${recursiveNote}: ${relativePath}`
          }
        ]
      }
    },
    { subtreeRoot: true }
  )
}
