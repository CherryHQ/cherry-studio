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
  'Convert an existing Markdown, Word (.docx), text PDF, PowerPoint (.pptx), Excel (.xlsx), or HTML artifact into another document format. ' +
  'Provide exactly one of source_path or markdown. HTML conversion is static: scripts and network resources are disabled. ' +
  'Word and PowerPoint contain editable text and tables; complex layouts may be simplified. Scanned PDFs require OCR first. ' +
  'PowerPoint splits at headings; Excel puts each table in a sheet, or plain text in one column when there is no table. ' +
  'An optional output_path must be workspace-relative, have the target extension and an existing parent directory. ' +
  'Existing files are never overwritten. Markdown images are saved in a companion resource directory. Requires user approval. ' +
  'The returned file automatically appears as an artifact card; do not call report_artifacts again for it.'

export const convertToDocumentInputSchema = z
  .object({
    markdown: z
      .string()
      .min(1)
      .refine(
        (value) => new TextEncoder().encode(value).byteLength <= DOCUMENT_MARKDOWN_MAX_BYTES,
        'Markdown exceeds the document conversion size limit'
      )
      .describe('Markdown content to convert (at most 2 MiB of UTF-8 text).')
      .optional(),
    source_path: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .optional()
      .describe(
        'Existing source file in the workspace, agent data directory, or session attachments. Mutually exclusive with markdown.'
      ),
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
  .refine(
    (input) => (input.markdown !== undefined) !== (input.source_path !== undefined),
    'Provide exactly one of markdown or source_path'
  )

export type ConvertToDocumentInput = z.infer<typeof convertToDocumentInputSchema>

export function isConvertToDocumentTool(toolName: string | undefined): boolean {
  return (
    toolName === CONVERT_TO_DOCUMENT_TOOL_NAME ||
    toolName === `mcp__cherry-tools__${CONVERT_TO_DOCUMENT_TOOL_NAME}` ||
    toolName === `mcp__cherry_tools__${CONVERT_TO_DOCUMENT_TOOL_NAME}`
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
