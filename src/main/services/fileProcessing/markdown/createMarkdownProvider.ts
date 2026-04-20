import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

import { doc2xMarkdownProvider } from './providers/doc2xMarkdownProvider'
import { mineruMarkdownProvider } from './providers/mineruMarkdownProvider'
import { openMineruMarkdownProvider } from './providers/openMineruMarkdownProvider'
import { paddleMarkdownProvider } from './providers/paddleMarkdownProvider'
import type { MarkdownProvider } from './types'

export function createMarkdownProvider(processorId: FileProcessorId): MarkdownProvider {
  switch (processorId) {
    case 'paddleocr':
      return paddleMarkdownProvider
    case 'mineru':
      return mineruMarkdownProvider
    case 'doc2x':
      return doc2xMarkdownProvider
    case 'open-mineru':
      return openMineruMarkdownProvider
    default:
      throw new Error(`File processor does not support markdown conversion: ${processorId}`)
  }
}
