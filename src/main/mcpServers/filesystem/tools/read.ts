import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'

import { DEFAULT_READ_LIMIT, isBinaryFile, MAX_LINE_LENGTH, validatePath } from '../types'

// Schema definition
export const ReadToolSchema = z.object({
  file_path: z.string().describe('The path to the file to read'),
  offset: z.number().optional().describe('The line number to start reading from (1-based)'),
  limit: z.number().optional().describe('The number of lines to read (defaults to 2000)')
})

// Tool definition
export const readToolDefinition = {
  name: 'read',
  description:
    'Read the contents of a file. Supports reading specific line ranges with offset and limit. ' +
    'Binary files are detected and rejected. Lines are truncated if they exceed 2000 characters.',
  inputSchema: z.toJSONSchema(ReadToolSchema)
}

// Handler implementation
export async function handleReadTool(args: unknown, allowedDirectories: string[]) {
  const parsed = ReadToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for read: ${parsed.error}`)
  }

  const filePath = parsed.data.file_path
  const validPath = await validatePath(allowedDirectories, filePath)

  // Check if file exists
  try {
    const stats = await fs.stat(validPath)
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`)
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`)
    }
    throw error
  }

  // Check if file is binary
  if (await isBinaryFile(validPath)) {
    throw new Error(`Cannot read binary file: ${filePath}`)
  }

  // Read file content
  const content = await fs.readFile(validPath, 'utf-8')
  const lines = content.split('\n')

  // Apply offset and limit
  const offset = (parsed.data.offset || 1) - 1 // Convert to 0-based
  const limit = parsed.data.limit || DEFAULT_READ_LIMIT

  if (offset < 0 || offset >= lines.length) {
    throw new Error(`Invalid offset: ${offset + 1}. File has ${lines.length} lines.`)
  }

  const selectedLines = lines.slice(offset, offset + limit)

  // Format output with line numbers and truncate long lines
  const output: string[] = []
  const relativePath = path.relative(process.cwd(), validPath)

  output.push(`File: ${relativePath}`)
  if (offset > 0 || limit < lines.length) {
    output.push(`Lines ${offset + 1} to ${Math.min(offset + limit, lines.length)} of ${lines.length}`)
  }
  output.push('')

  selectedLines.forEach((line, index) => {
    const lineNumber = offset + index + 1
    const truncatedLine = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + '...' : line
    output.push(`${lineNumber.toString().padStart(6)}\t${truncatedLine}`)
  })

  if (offset + limit < lines.length) {
    output.push('')
    output.push(`(${lines.length - (offset + limit)} more lines not shown)`)
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
