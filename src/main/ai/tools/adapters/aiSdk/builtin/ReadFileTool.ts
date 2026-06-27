/**
 * read_file tool — reads an attached file's text by `filename` (announced in the
 * conversation). The lookup lives in the shared `fileLookup` core; this file is
 * just the AI-SDK `tool()` wrapper. Text-only: natively-consumable files are
 * inlined by the chat path, never routed here.
 */

import { READ_FILE_TOOL_NAME, readFileInputSchema, readFileResultSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'

import { READ_FILE_DESCRIPTION, readFile, readFileModelOutput } from '../../../fileLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

const readFileTool = tool({
  description: READ_FILE_DESCRIPTION,
  inputSchema: readFileInputSchema,
  outputSchema: readFileResultSchema,
  strict: true,
  execute: async (input, options) => {
    const { request } = getToolCallContext(options)
    return readFile(input, { attachments: request.fileAttachments ?? [] }, request.abortSignal)
  },
  toModelOutput: ({ output }) => readFileModelOutput(output)
})

export function createReadFileToolEntry(): ToolEntry {
  return {
    name: READ_FILE_TOOL_NAME,
    namespace: 'file',
    description: 'Read an attached file by filename — returns its text (paged for long files)',
    // Always inline when active so the model can call it directly off the manifest.
    defer: 'never',
    tool: readFileTool,
    applies: (scope) => scope.hasFileAttachments === true
  }
}

export type ReadFileToolInput = InferToolInput<typeof readFileTool>
export type ReadFileToolOutput = InferToolOutput<typeof readFileTool>
