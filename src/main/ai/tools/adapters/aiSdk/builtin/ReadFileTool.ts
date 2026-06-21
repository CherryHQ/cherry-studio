/**
 * read_file tool — agentic file reading.
 *
 * The model pulls an attached file's content by `fileEntryId` (announced in the
 * attachment manifest). The lookup + capability decision live in the shared
 * `fileLookup` core; this file is just the AI-SDK `tool()` wrapper.
 *
 * `toModelOutput` re-reads media to base64 at send time, so the stored tool
 * output stays compact and re-materializes on resend (see `Agent` passing
 * `tools` to `convertToModelMessages`).
 */

import { READ_FILE_TOOL_NAME, readFileInputSchema, readFileOutputSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import { READ_FILE_DESCRIPTION, readFile, readFileModelOutput } from '../../../fileLookup'
import type { FileToolCapabilities } from '../context'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

/** No-capability fallback: synthetic requests that never threaded caps get text/OCR (never native media). */
const NO_FILE_TOOL_CAPS: FileToolCapabilities = {
  acceptsMediaInToolResult: false,
  isVision: false,
  isAudio: false,
  isVideo: false
}

const readFileResultSchema = z.union([readFileOutputSchema, z.object({ error: z.string() })])

const readFileTool = tool({
  description: READ_FILE_DESCRIPTION,
  inputSchema: readFileInputSchema,
  outputSchema: readFileResultSchema,
  strict: true,
  execute: async (input, options) => {
    const { request } = getToolCallContext(options)
    return readFile(
      input,
      { caps: request.fileToolCaps ?? NO_FILE_TOOL_CAPS, attachments: request.fileAttachments ?? [] },
      request.abortSignal
    )
  },
  toModelOutput: ({ output }) => readFileModelOutput(output)
})

export function createReadFileToolEntry(): ToolEntry {
  return {
    name: READ_FILE_TOOL_NAME,
    namespace: 'file',
    description: 'Read an attached file by id — returns text, or native image/PDF for capable models',
    // Always inline when active so the model can call it directly off the manifest.
    defer: 'never',
    tool: readFileTool,
    applies: (scope) => scope.hasFileAttachments === true
  }
}

export type ReadFileToolInput = InferToolInput<typeof readFileTool>
export type ReadFileToolOutput = InferToolOutput<typeof readFileTool>
