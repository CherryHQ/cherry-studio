import { isLocalPaddleocrModelDownloaded } from '@main/ai/inference/ocrModelPaths'
import { isMac, isWin } from '@main/core/platform'

import { doc2xDocumentToMarkdownHandler } from './doc2x/documentToMarkdown/handler'
import { localPaddleocrImageToTextHandler } from './localPaddleocr/imageToText/handler'
import { mineruDocumentToMarkdownHandler } from './mineru/documentToMarkdown/handler'
import { mistralDocumentToMarkdownHandler } from './mistral/documentToMarkdown/handler'
import { mistralImageToTextHandler } from './mistral/imageToText/handler'
import { openMineruDocumentToMarkdownHandler } from './openMineru/documentToMarkdown/handler'
import { ovocrImageToTextHandler } from './ovocr/imageToText/handler'
import { isOvOcrAvailable } from './ovocr/utils'
import { paddleDocumentToMarkdownHandler } from './paddleocr/documentToMarkdown/handler'
import { paddleImageToTextHandler } from './paddleocr/imageToText/handler'
import { systemImageToTextHandler } from './system/imageToText/handler'
import { tesseractImageToTextHandler } from './tesseract/imageToText/handler'
import type { FileProcessingProcessorRegistry } from './types'

export const processorRegistry = {
  tesseract: {
    isAvailable: () => true,
    capabilities: {
      image_to_text: tesseractImageToTextHandler
    }
  },
  system: {
    isAvailable: () => isMac || isWin,
    capabilities: {
      image_to_text: systemImageToTextHandler
    }
  },
  paddleocr: {
    isAvailable: () => true,
    capabilities: {
      image_to_text: paddleImageToTextHandler,
      document_to_markdown: paddleDocumentToMarkdownHandler
    }
  },
  'local-paddleocr': {
    // Only usable once the model files are on disk (downloaded via the settings card).
    isAvailable: isLocalPaddleocrModelDownloaded,
    capabilities: {
      image_to_text: localPaddleocrImageToTextHandler
    }
  },
  ovocr: {
    isAvailable: isOvOcrAvailable,
    capabilities: {
      image_to_text: ovocrImageToTextHandler
    }
  },
  mineru: {
    isAvailable: () => true,
    capabilities: {
      document_to_markdown: mineruDocumentToMarkdownHandler
    }
  },
  doc2x: {
    isAvailable: () => true,
    capabilities: {
      document_to_markdown: doc2xDocumentToMarkdownHandler
    }
  },
  mistral: {
    isAvailable: () => true,
    capabilities: {
      document_to_markdown: mistralDocumentToMarkdownHandler,
      image_to_text: mistralImageToTextHandler
    }
  },
  'open-mineru': {
    isAvailable: () => true,
    capabilities: {
      document_to_markdown: openMineruDocumentToMarkdownHandler
    }
  }
} satisfies FileProcessingProcessorRegistry
