import * as z from 'zod'

import {
  DOCUMENT_MARKDOWN_MAX_BYTES,
  documentArtifactSchema,
  documentFormatSchema,
  type DocumentArtifact
} from '@shared/types/documentConversion'

import { PI_TOOL_CALL_TOOL_NAME } from './piBuiltinTools'

export const CONVERT_TO_DOCUMENT_TOOL_NAME = 'convert_to_document'
export const CONVERT_TO_DOCUMENT_DESCRIPTION =
  'Convert Markdown into a PDF, Word (.docx), PowerPoint (.pptx), or Excel (.xlsx) document in the current workspace. ' +
  'Pass Markdown content and the desired format. PowerPoint uses H2 headings as slides; Excel uses Markdown tables as sheets. ' +
  'An optional output_path must be workspace-relative, use the selected format extension, and have an existing parent directory. ' +
  'Existing files are never overwritten. Requires user approval. The returned document automatically appears as a file card; ' +
  'do not call report_artifacts again for this file.'

export const convertToDocumentInputSchema = z.object({
  markdown: z
    .string()
    .min(1)
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= DOCUMENT_MARKDOWN_MAX_BYTES,
      'Markdown exceeds the document conversion size limit'
    )
    .describe('Markdown content to convert (at most 2 MiB of UTF-8 text).'),
  format: documentFormatSchema,
  output_path: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => !/^(?:[/\\]|[A-Za-z]:)/.test(value), 'Output path must be workspace-relative')
    .refine((value) => !value.split(/[\\/]+/).includes('..'), 'Output path must not traverse outside the workspace')
    .optional()
    .describe('New workspace-relative filename. Omit to generate a unique filename in the workspace.')
})

export type ConvertToDocumentInput = z.infer<typeof convertToDocumentInputSchema>

export function isConvertToDocumentTool(toolName: string | undefined): boolean {
  return (
    toolName === CONVERT_TO_DOCUMENT_TOOL_NAME || toolName === `mcp__cherry-tools__${CONVERT_TO_DOCUMENT_TOOL_NAME}`
  )
}

/** Accept a direct receipt or the MCP result envelope, but never an error result. */
export function parseConvertedDocumentOutput(output: unknown): DocumentArtifact | undefined {
  for (let depth = 0; depth < 5; depth++) {
    if (output && typeof output === 'object' && 'isError' in output && output.isError) return undefined
    const direct = documentArtifactSchema.safeParse(output)
    if (direct.success && direct.data.path.trim()) return direct.data
    if (typeof output === 'string') {
      try {
        output = JSON.parse(output)
      } catch {
        return undefined
      }
    } else if (Array.isArray(output)) {
      output = output.find((item) => item?.type === 'text')?.text
    } else if (output && typeof output === 'object' && 'content' in output) {
      output = output.content
    } else {
      return undefined
    }
  }
  return undefined
}

export function getConvertedDocumentArtifacts(
  toolName: string | undefined,
  input: unknown,
  output: unknown
): DocumentArtifact[] {
  if (toolName === PI_TOOL_CALL_TOOL_NAME) {
    toolName =
      input && typeof input === 'object' && 'name' in input && typeof input.name === 'string' ? input.name : undefined
  }
  if (isConvertToDocumentTool(toolName)) {
    const artifact = parseConvertedDocumentOutput(output)
    return artifact ? [artifact] : []
  }
  return []
}
