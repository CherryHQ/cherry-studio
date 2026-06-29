import { OfficeConverter, type SupportedFileType } from 'officeparser'

/**
 * Shared `officeparser` text-extraction config + wrapper.
 *
 * Single source of truth for "parse an Office document to plain text" so the
 * preview fallback, the AI `read_file` path, and FileStorage stay in sync.
 * Returns the raw extracted text (callers trim if they need to).
 */
const OFFICE_TEXT_GENERATOR_CONFIG = {
  includeImages: false,
  includeCharts: false,
  textConfig: {
    newlineDelimiter: '\n',
    preserveLayout: true
  }
} as const

export async function convertOfficeToText(source: string | Buffer, fileType?: SupportedFileType): Promise<string> {
  const result = await OfficeConverter.convert(source, 'text', {
    ...(fileType ? { parseConfig: { fileType } } : {}),
    generatorConfig: OFFICE_TEXT_GENERATOR_CONFIG
  })
  return String(result.value)
}
