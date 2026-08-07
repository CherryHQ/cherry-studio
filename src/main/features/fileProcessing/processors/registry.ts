import { isDarwinX64, isMac, isWin } from '@main/core/platform'

import { doc2xDocumentToMarkdownHandler } from './doc2x/documentToMarkdown/handler'
import { localDocumentToMarkdownHandler } from './localDocument/documentToMarkdown/handler'
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
    runtime: 'local',
    isSupported: () => true,
    capabilities: {
      image_to_text: tesseractImageToTextHandler
    }
  },
  system: {
    runtime: 'local',
    isSupported: () => isMac || isWin,
    capabilities: {
      image_to_text: systemImageToTextHandler
    }
  },
  paddleocr: {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      image_to_text: paddleImageToTextHandler,
      document_to_markdown: paddleDocumentToMarkdownHandler
    }
  },
  'local-paddleocr': {
    runtime: 'local',
    // Intel Mac ships no onnxruntime-node binding, so the model can never run
    // there. Whether it is *downloaded* is a separate, user-fixable question the
    // UI must keep offering — see FILE_PROCESSOR_LOCAL_MODEL.
    isSupported: () => !isDarwinX64,
    capabilities: {
      image_to_text: localPaddleocrImageToTextHandler
    }
  },
  'local-document': {
    runtime: 'local',
    // Scanned PDFs fall back to the local OCR model, so this shares its platform gate.
    isSupported: () => !isDarwinX64,
    capabilities: {
      document_to_markdown: localDocumentToMarkdownHandler
    }
  },
  ovocr: {
    runtime: 'local',
    isSupported: isOvOcrAvailable,
    capabilities: {
      image_to_text: ovocrImageToTextHandler
    }
  },
  mineru: {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      document_to_markdown: mineruDocumentToMarkdownHandler
    }
  },
  doc2x: {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      document_to_markdown: doc2xDocumentToMarkdownHandler
    }
  },
  mistral: {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      document_to_markdown: mistralDocumentToMarkdownHandler,
      image_to_text: mistralImageToTextHandler
    }
  },
  'open-mineru': {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      document_to_markdown: openMineruDocumentToMarkdownHandler
    }
  }
} satisfies FileProcessingProcessorRegistry
