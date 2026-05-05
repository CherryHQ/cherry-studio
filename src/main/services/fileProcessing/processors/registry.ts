import { doc2xDocumentToMarkdownHandler } from './doc2x/document-to-markdown/handler'
import { mineruDocumentToMarkdownHandler } from './mineru/document-to-markdown/handler'
import { mistralImageToTextHandler } from './mistral/image-to-text/handler'
import { openMineruDocumentToMarkdownHandler } from './open-mineru/document-to-markdown/handler'
import { ovocrImageToTextHandler } from './ovocr/image-to-text/handler'
import { paddleDocumentToMarkdownHandler } from './paddleocr/document-to-markdown/handler'
import { paddleImageToTextHandler } from './paddleocr/image-to-text/handler'
import { systemImageToTextHandler } from './system/image-to-text/handler'
import { tesseractImageToTextHandler } from './tesseract/image-to-text/handler'
import type { FileProcessingProcessorRegistry } from './types'

export const processorRegistry = {
  tesseract: {
    capabilities: {
      image_to_text: tesseractImageToTextHandler
    }
  },
  system: {
    capabilities: {
      image_to_text: systemImageToTextHandler
    }
  },
  paddleocr: {
    capabilities: {
      image_to_text: paddleImageToTextHandler,
      document_to_markdown: paddleDocumentToMarkdownHandler
    }
  },
  ovocr: {
    capabilities: {
      image_to_text: ovocrImageToTextHandler
    }
  },
  mineru: {
    capabilities: {
      document_to_markdown: mineruDocumentToMarkdownHandler
    }
  },
  doc2x: {
    capabilities: {
      document_to_markdown: doc2xDocumentToMarkdownHandler
    }
  },
  mistral: {
    capabilities: {
      image_to_text: mistralImageToTextHandler
    }
  },
  'open-mineru': {
    capabilities: {
      document_to_markdown: openMineruDocumentToMarkdownHandler
    }
  }
} satisfies FileProcessingProcessorRegistry
