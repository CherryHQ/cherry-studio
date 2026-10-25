import { documentFormats, type DocumentFormat } from '@shared/types/documentConversion'
import { getDocumentSourceFormat } from '@shared/utils/documentConversion'

export function getDocumentConversionFormats(filename: string): DocumentFormat[] {
  const source = getDocumentSourceFormat(filename)
  return source ? documentFormats.filter((format) => format !== source) : []
}
