import { isMac, isWin } from '@main/constant'

import { doc2xDocumentToMarkdownHandler } from './doc2x/document-to-markdown/handler'
import { mineruDocumentToMarkdownHandler } from './mineru/document-to-markdown/handler'
import { mistralDocumentToMarkdownHandler } from './mistral/document-to-markdown/handler'
import { mistralImageToTextHandler } from './mistral/image-to-text/handler'
import { openMineruDocumentToMarkdownHandler } from './open-mineru/document-to-markdown/handler'
import { ovocrImageToTextHandler } from './ovocr/image-to-text/handler'
import { isOvOcrAvailable } from './ovocr/utils'
import { paddleDocumentToMarkdownHandler } from './paddleocr/document-to-markdown/handler'
import { paddleImageToTextHandler } from './paddleocr/image-to-text/handler'
import { systemImageToTextHandler } from './system/image-to-text/handler'
import { tesseractImageToTextHandler } from './tesseract/image-to-text/handler'
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
