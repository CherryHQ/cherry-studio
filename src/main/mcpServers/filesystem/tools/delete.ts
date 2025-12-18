import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'

import { logger, validatePath } from '../types'

// Schema definition
export const DeleteToolSchema = z.object({
  path: z.string().describe('The path to the file or directory to delete'),
  recursive: z.boolean().optional().describe('For directories, whether to delete recursively (default: false)')
})

// Tool definition with detailed description
export const deleteToolDefinition = {
  name: 'delete',
  description: `Deletes a file or directory from the filesystem.

CAUTION: This operation cannot be undone!

- For files: simply provide the path
- For empty directories: provide the path
- For non-empty directories: set recursive=true
- The path must be an absolute path, not a relative path
- Always verify the path before deleting to avoid data loss`,
  inputSchema: z.toJSONSchema(DeleteToolSchema)
}

// Handler implementation
export async function handleDeleteTool(args: unknown, baseDir: string) {
  const parsed = DeleteToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for delete: ${parsed.error}`)
  }

  const targetPath = parsed.data.path
  const validPath = await validatePath(targetPath, baseDir)
  const recursive = parsed.data.recursive || false

  // Check if path exists and get stats
  let stats
  try {
    stats = await fs.stat(validPath)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Path not found: ${targetPath}`)
    }
    throw error
  }

  const isDirectory = stats.isDirectory()
  const relativePath = path.relative(baseDir, validPath)

  // Perform deletion
  try {
    if (isDirectory) {
      if (recursive) {
        // Delete directory recursively
        await fs.rm(validPath, { recursive: true, force: true })
      } else {
        // Try to delete empty directory
        await fs.rmdir(validPath)
      }
    } else {
      // Delete file
      await fs.unlink(validPath)
    }
  } catch (error: any) {
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
}
