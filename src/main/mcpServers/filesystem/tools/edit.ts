import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'

import { logger, replaceWithFuzzyMatch, validatePath } from '../types'

// Schema definition
export const EditToolSchema = z.object({
  file_path: z.string().describe('The absolute path to the file to modify'),
  old_string: z.string().describe('The text to replace'),
  new_string: z.string().describe('The text to replace it with (must be different from old_string)'),
  replace_all: z.boolean().optional().default(false).describe('Replace all occurrences of old_string (default false)')
})

// Tool definition with detailed description
export const editToolDefinition = {
  name: 'edit',
  description: `Performs exact string replacements in files.

Usage:
- You must use the 'read' tool at least once before editing to understand the file content.
- When editing text from read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix.
- The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match.
- Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- The edit will FAIL if 'old_string' is not found in the file with an error "old_string not found in content".
- The edit will FAIL if 'old_string' is found multiple times in the file. Either provide a larger string with more surrounding context to make it unique or use 'replace_all' to change every instance.
- Use 'replace_all' for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
  inputSchema: z.toJSONSchema(EditToolSchema)
}

// Handler implementation
export async function handleEditTool(args: unknown, baseDir: string) {
  const parsed = EditToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for edit: ${parsed.error}`)
  }

  const { file_path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll } = parsed.data

  // Validate path
  const validPath = await validatePath(filePath, baseDir)

  // Check if file exists
  try {
    const stats = await fs.stat(validPath)
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`)
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // If old_string is empty, this is a create new file operation
      if (oldString === '') {
        // Create parent directory if needed
        const parentDir = path.dirname(validPath)
        await fs.mkdir(parentDir, { recursive: true })

        // Write the new content
        await fs.writeFile(validPath, newString, 'utf-8')

        logger.info('File created', { path: validPath })

        const relativePath = path.relative(baseDir, validPath)
        return {
          content: [
            {
              type: 'text',
              text: `Created new file: ${relativePath}\nLines: ${newString.split('\n').length}`
            }
          ]
        }
      }
      throw new Error(`File not found: ${filePath}`)
    }
    throw error
  }

  // Read current content
  const content = await fs.readFile(validPath, 'utf-8')

  // Handle special case: old_string is empty (create file with content)
  if (oldString === '') {
    await fs.writeFile(validPath, newString, 'utf-8')

    logger.info('File overwritten', { path: validPath })

    const relativePath = path.relative(baseDir, validPath)
    return {
      content: [
        {
          type: 'text',
          text: `Overwrote file: ${relativePath}\nLines: ${newString.split('\n').length}`
        }
      ]
    }
  }

  // Perform the replacement with fuzzy matching
  const newContent = replaceWithFuzzyMatch(content, oldString, newString, replaceAll)

  // Write the modified content
  await fs.writeFile(validPath, newContent, 'utf-8')

  logger.info('File edited', {
    path: validPath,
    replaceAll
  })

  // Generate a simple diff summary
  const oldLines = content.split('\n').length
  const newLines = newContent.split('\n').length
  const lineDiff = newLines - oldLines

  const relativePath = path.relative(baseDir, validPath)
  let diffSummary = `Edited: ${relativePath}`
  if (lineDiff > 0) {
    diffSummary += `\n+${lineDiff} lines`
  } else if (lineDiff < 0) {
    diffSummary += `\n${lineDiff} lines`
  }

  return {
    content: [
      {
        type: 'text',
        text: diffSummary
      }
    ]
  }
}
