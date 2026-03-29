import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

import type { IMarkdownConversionProcessor, ITextExtractionProcessor } from '../interfaces'
import { doc2xProcessor } from './api/doc2x/doc2xProcessor'
import { mineruProcessor } from './api/mineru/mineruProcessor'
import { mistralProcessor } from './api/mistral/mistralProcessors'
import { OpenMineruProcessor } from './api/OpenMineruProcessor'
import { PaddleProcessor } from './api/PaddleProcessor'
import { OvOcrProcessor } from './builtin/ovocr/OvOcrProcessor'
import { SystemOcrProcessor } from './builtin/system/SystemOcrProcessor'
import { TesseractProcessor } from './builtin/tesseract/TesseractProcessor'

export function createTextExtractionProcessor(processorId: FileProcessorId): ITextExtractionProcessor {
  switch (processorId) {
    case 'tesseract':
      return new TesseractProcessor()
    case 'system':
      return new SystemOcrProcessor()
    case 'paddleocr':
      return new PaddleProcessor()
    case 'ovocr':
      return new OvOcrProcessor()
    case 'mistral':
      return mistralProcessor
    default:
      throw new Error(`File processor does not support text extraction: ${processorId}`)
  }
}

export function createMarkdownConversionProcessor(processorId: FileProcessorId): IMarkdownConversionProcessor {
  switch (processorId) {
    case 'paddleocr':
      return new PaddleProcessor()
    case 'mineru':
      return mineruProcessor
    case 'doc2x':
      return doc2xProcessor
    case 'open-mineru':
      return new OpenMineruProcessor()
    default:
      throw new Error(`File processor does not support markdown conversion: ${processorId}`)
  }
}
