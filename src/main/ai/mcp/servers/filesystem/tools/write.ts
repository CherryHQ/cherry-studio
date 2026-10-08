import path from 'path'

import type { CallToolResult } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { ensureDir, stat, writeInPlace } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { filesystemMutationService } from '../FilesystemMutationService'
import { logger } from '../types'

// Schema definition
export const WriteToolSchema = z.object({
  file_path: z.string().describe('The path to the file to write'),
  content: z.string().describe('The content to write to the file')
})

// Tool definition with detailed description
export const writeToolDefinition = {
  description: `Writes a file to the local filesystem.

- This tool will overwrite the existing file if one exists at the path
- You MUST use the read tool first to understand what you're overwriting
- ALWAYS prefer using the 'edit' tool for existing files
- NEVER proactively create documentation files unless explicitly requested
- Parent directories will be created automatically if they don't exist
- The file_path must resolve within the configured workspace root`,
  inputSchema: WriteToolSchema
}

// Handler implementation
export async function handleWriteTool(args: z.infer<typeof WriteToolSchema>, baseDir: string): Promise<CallToolResult> {
  const filePath = args.file_path
  return filesystemMutationService.runExclusive(filePath, baseDir, async (validPath) => {
    // Create parent directory if it doesn't exist
    const parentDir = path.dirname(validPath)
    try {
      await ensureDir(AbsoluteFilePathSchema.parse(parentDir))
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create parent directory: ${error.message}`)
      }
    }

    // Check if file exists (for logging)
    let isOverwrite = false
    try {
      await stat(validPath)
      isOverwrite = true
    } catch {
      // File doesn't exist, that's fine
    }

    // Write the file
    try {
      await writeInPlace(validPath, args.content)
    } catch (error: any) {
      throw new Error(`Failed to write file ${filePath}: ${error.message}`)
    }

    // Log the operation
    logger.info('File written', {
      path: validPath,
      overwrite: isOverwrite,
      size: args.content.length
    })

    // Format output
    const relativePath = path.relative(baseDir, validPath)
    const action = isOverwrite ? 'Updated' : 'Created'
    const lines = args.content.split('\n').length

    return {
      content: [
        {
          type: 'text',
          text: `${action} file: ${relativePath}\n` + `Size: ${args.content.length} bytes\n` + `Lines: ${lines}`
        }
      ]
    }
  })
}
