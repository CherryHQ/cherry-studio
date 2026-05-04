/**
 * PDF reader — routes through `fileProcessingService.extractDocumentText`
 * so user-configured processors (mineru, doc2x, etc.) can be plugged in
 * later without changing the dispatcher. Today it falls back to the
 * built-in pdf-parse extractor.
 */

import { fileProcessingService } from '@data/services/FileProcessingService'

import { formatLines, type TextReadResult } from './text'

export async function readAsPdf(
  absolutePath: string,
  offset: number | undefined,
  limit: number | undefined
): Promise<TextReadResult> {
  const text = await fileProcessingService.extractDocumentText(absolutePath)
  return formatLines(text, offset, limit)
}
