import { documentFormats, type DocumentFormat } from '@shared/types/documentConversion'

export function getDocumentSourceFormat(filename: string): DocumentFormat | undefined {
  const extension = filename.split('.').at(-1)?.toLowerCase()
  if (extension === 'markdown') return 'md'
  if (extension === 'htm') return 'html'
  return documentFormats.find((format) => format === extension)
}
