import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'

import { logger, validatePath } from '../types'

// Schema definition
export const WriteToolSchema = z.object({
  file_path: z.string().describe('The path to the file to write'),
  content: z.string().describe('The content to write to the file')
})

// Tool definition with detailed description
export const writeToolDefinition = {
  name: 'write',
  description: `Writes a file to the local filesystem.

- This tool will overwrite the existing file if one exists at the path
- You MUST use the read tool first to understand what you're overwriting
- ALWAYS prefer using the 'edit' tool for existing files
- NEVER proactively create documentation files unless explicitly requested
- Parent directories will be created automatically if they don't exist
- The file_path must be an absolute path, not a relative path`,
  inputSchema: z.toJSONSchema(WriteToolSchema)
}

// Handler implementation
export async function handleWriteTool(args: unknown, baseDir: string) {
  const parsed = WriteToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for write: ${parsed.error}`)
  }

  const filePath = parsed.data.file_path
  const validPath = await validatePath(filePath, baseDir)

  // Create parent directory if it doesn't exist
  const parentDir = path.dirname(validPath)
  try {
    await fs.mkdir(parentDir, { recursive: true })
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw new Error(`Failed to create parent directory: ${error.message}`)
    }
  }

  // Check if file exists (for logging)
  let isOverwrite = false
  try {
    await fs.stat(validPath)
    isOverwrite = true
  } catch {
    // File doesn't exist, that's fine
  }

  // Write the file
  try {
    await fs.writeFile(validPath, parsed.data.content, 'utf-8')
  } catch (error: any) {
    throw new Error(`Failed to write file: ${error.message}`)
  }

  // Log the operation
  logger.info('File written', {
    path: validPath,
    overwrite: isOverwrite,
    size: parsed.data.content.length
  })

  // Format output
  const relativePath = path.relative(baseDir, validPath)
  const action = isOverwrite ? 'Updated' : 'Created'
  const lines = parsed.data.content.split('\n').length

  return {
    content: [
      {
        type: 'text',
        text: `${action} file: ${relativePath}\n` + `Size: ${parsed.data.content.length} bytes\n` + `Lines: ${lines}`
      }
    ]
  }
}
