import path from 'path'

import type { CallToolResult } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { ensureDir, read, stat, writeInPlace } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import { filesystemMutationService } from '../FilesystemMutationService'
import { logger, replaceWithFuzzyMatch } from '../types'

// Schema definition
export const EditToolSchema = z.object({
  file_path: z.string().describe('The path to the file to modify'),
  old_string: z.string().describe('The text to replace'),
  new_string: z.string().describe('The text to replace it with'),
  replace_all: z.boolean().optional().default(false).describe('Replace all occurrences of old_string (default false)')
})

// Tool definition with detailed description
export const editToolDefinition = {
  description: `Performs exact string replacements in files.

- You must use the 'read' tool at least once before editing
- The file_path must resolve within the configured workspace root
- Preserve exact indentation from read output (after the line number prefix)
- Never include line number prefixes in old_string or new_string
- ALWAYS prefer editing existing files over creating new ones
- The edit will FAIL if old_string is not found in the file
- The edit will FAIL if old_string appears multiple times (provide more context or use replace_all)
- The edit will FAIL if old_string equals new_string
- Use replace_all to rename variables or replace all occurrences`,
  inputSchema: EditToolSchema
}

async function writeEdit(validPath: AbsoluteFilePath, content: string, filePath: string): Promise<void> {
  try {
    await writeInPlace(validPath, content)
  } catch (error: any) {
    throw new Error(`Failed to edit file ${filePath}: ${error.message}`)
  }
}

// Handler implementation
export async function handleEditTool(args: z.input<typeof EditToolSchema>, baseDir: string): Promise<CallToolResult> {
  const { file_path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll = false } = args

  return filesystemMutationService.runExclusive(filePath, baseDir, async (validPath) => {
    // Check if file exists
    try {
      const stats = await stat(validPath)
      if (!stats.isFile) {
        throw new Error(`Path is not a file: ${filePath}`)
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // If old_string is empty, this is a create new file operation
        if (oldString === '') {
          // Create parent directory if needed
          const parentDir = path.dirname(validPath)
          await ensureDir(AbsoluteFilePathSchema.parse(parentDir))

          await writeEdit(validPath, newString, filePath)

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
    const content = await read(validPath)

    // Handle special case: old_string is empty (create file with content)
    if (oldString === '') {
      await writeEdit(validPath, newString, filePath)

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

    await writeEdit(validPath, newContent, filePath)

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
  })
}
