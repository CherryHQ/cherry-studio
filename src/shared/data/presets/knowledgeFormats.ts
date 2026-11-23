import * as z from 'zod'

export const KNOWLEDGE_FORMATS = [
  { extensions: ['.txt', '.markdown', '.md', '.mdx'], reader: 'text' },
  { extensions: ['.html', '.htm'], reader: 'html' },
  { extensions: ['.csv'], reader: 'csv' },
  { extensions: ['.pdf'], reader: 'pdf' },
  {
    extensions: ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.epub'],
    reader: 'anydoc'
  },
  { extensions: ['.draftsexport'], reader: 'drafts' }
] as const

export const KNOWLEDGE_FORMAT_EXTENSIONS = KNOWLEDGE_FORMATS.flatMap<string>((format) => [...format.extensions])

export const KnowledgeFilePreflightSchema = z.strictObject({
  path: z.string(),
  size: z.number().nonnegative().optional(),
  pageCount: z.number().int().nonnegative().optional(),
  processor: z.string(),
  maxInputBytes: z.number().positive().optional(),
  maxInputPages: z.number().int().positive().optional(),
  reason: z.enum([
    'ok',
    'unsupported_format',
    'unreadable_file',
    'size_limit',
    'page_limit',
    'processor_not_configured',
    'ocr_required',
    'parser_unavailable'
  ])
})
export type KnowledgeFilePreflight = z.infer<typeof KnowledgeFilePreflightSchema>

export function evaluateKnowledgeFilePreflight(
  input: Omit<KnowledgeFilePreflight, 'reason'> & {
    hasTextlessPages?: boolean
    processorConfigured?: boolean
    parserAvailable?: boolean
  }
): KnowledgeFilePreflight {
  const { hasTextlessPages, processorConfigured, parserAvailable, ...result } = input
  const extension = /\.[^./\\]+$/.exec(input.path)?.[0].toLowerCase()
  let reason: KnowledgeFilePreflight['reason'] = 'ok'
  if (!KNOWLEDGE_FORMAT_EXTENSIONS.some((ext) => ext === extension)) reason = 'unsupported_format'
  else if (input.size === undefined) reason = 'unreadable_file'
  else if (parserAvailable === false) reason = 'parser_unavailable'
  else if (processorConfigured === false) reason = 'processor_not_configured'
  else if (input.maxInputBytes !== undefined && input.size >= input.maxInputBytes) reason = 'size_limit'
  else if (input.maxInputPages !== undefined && input.pageCount !== undefined && input.pageCount > input.maxInputPages)
    reason = 'page_limit'
  else if (hasTextlessPages && input.processor === 'pdf') reason = 'ocr_required'
  return { ...result, reason }
}
