import { isDarwinX64, isMac, isWin, isWinArm64 } from '@main/core/platform'
import type { FileProcessorFeature } from '@shared/data/preference/preferenceTypes'

import { isOvOcrAvailable } from './ovocr/utils'
import type { FileProcessingCapabilityHandler, FileProcessingProcessorRegistry } from './types'

function lazyHandler<Feature extends FileProcessorFeature>(
  mode: FileProcessingCapabilityHandler['mode'],
  load: () => Promise<FileProcessingCapabilityHandler<Feature>>,
  imageOcrOutput?: FileProcessingCapabilityHandler<Feature>['imageOcrOutput']
): FileProcessingCapabilityHandler<Feature> {
  let handlerPromise: Promise<FileProcessingCapabilityHandler<Feature>> | undefined

  return {
    mode,
    ...(imageOcrOutput ? { imageOcrOutput } : {}),
    async prepare(file, config, signal, context) {
      const handler = await (handlerPromise ??= load())
      return handler.prepare(file, config, signal, context)
    }
  }
}

export const processorRegistry = {
  tesseract: {
    runtime: 'local',
    isSupported: () => true,
    capabilities: {
      image_to_text: lazyHandler(
        'background',
        async () =>
          import('./tesseract/imageToText/handler').then(
            ({ tesseractImageToTextHandler }) => tesseractImageToTextHandler
          ),
        'plain-text'
      )
    }
  },
  system: {
    runtime: 'local',
    isSupported: () => isMac || isWin,
    capabilities: {
      image_to_text: lazyHandler(
        'background',
        async () =>
          import('./system/imageToText/handler').then(({ systemImageToTextHandler }) => systemImageToTextHandler),
        isMac ? 'spatial-text' : 'plain-text'
      )
    }
  },
  paddleocr: {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      image_to_text: lazyHandler(
        'background',
        async () =>
          import('./paddleocr/imageToText/handler').then(({ paddleImageToTextHandler }) => paddleImageToTextHandler),
        'plain-text'
      ),
      document_to_markdown: lazyHandler('remote-poll', async () =>
        import('./paddleocr/documentToMarkdown/handler').then(
          ({ paddleDocumentToMarkdownHandler }) => paddleDocumentToMarkdownHandler
        )
      )
    }
  },
  'local-paddleocr': {
    runtime: 'local',
    // Intel Mac ships no onnxruntime-node binding, so the model can never run
    // there. Whether it is *downloaded* is a separate, user-fixable question the
    // UI must keep offering — see FILE_PROCESSOR_LOCAL_MODEL.
    isSupported: () => !isDarwinX64,
    capabilities: {
      image_to_text: lazyHandler(
        'background',
        async () =>
          import('./localPaddleocr/imageToText/handler').then(
            ({ localPaddleocrImageToTextHandler }) => localPaddleocrImageToTextHandler
          ),
        'spatial-text'
      )
    }
  },
  'local-document': {
    runtime: 'local',
    // Scanned PDFs need the local OCR model, while text PDFs need anydoc. The
    // latter ships no Windows ARM64 binding or wasm fallback.
    isSupported: () => !isDarwinX64 && !isWinArm64,
    capabilities: {
      document_to_markdown: lazyHandler('background', async () =>
        import('./localDocument/documentToMarkdown/handler').then(
          ({ localDocumentToMarkdownHandler }) => localDocumentToMarkdownHandler
        )
      )
    }
  },
  ovocr: {
    runtime: 'local',
    isSupported: isOvOcrAvailable,
    capabilities: {
      image_to_text: lazyHandler(
        'background',
        async () =>
          import('./ovocr/imageToText/handler').then(({ ovocrImageToTextHandler }) => ovocrImageToTextHandler),
        'plain-text'
      )
    }
  },
  mineru: {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      document_to_markdown: lazyHandler('remote-poll', async () =>
        import('./mineru/documentToMarkdown/handler').then(
          ({ mineruDocumentToMarkdownHandler }) => mineruDocumentToMarkdownHandler
        )
      )
    }
  },
  doc2x: {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      document_to_markdown: lazyHandler('remote-poll', async () =>
        import('./doc2x/documentToMarkdown/handler').then(
          ({ doc2xDocumentToMarkdownHandler }) => doc2xDocumentToMarkdownHandler
        )
      )
    }
  },
  mistral: {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      document_to_markdown: lazyHandler('background', async () =>
        import('./mistral/documentToMarkdown/handler').then(
          ({ mistralDocumentToMarkdownHandler }) => mistralDocumentToMarkdownHandler
        )
      ),
      image_to_text: lazyHandler(
        'background',
        async () =>
          import('./mistral/imageToText/handler').then(({ mistralImageToTextHandler }) => mistralImageToTextHandler),
        'plain-text'
      )
    }
  },
  'open-mineru': {
    runtime: 'remote',
    isSupported: () => true,
    capabilities: {
      document_to_markdown: lazyHandler('background', async () =>
        import('./openMineru/documentToMarkdown/handler').then(
          ({ openMineruDocumentToMarkdownHandler }) => openMineruDocumentToMarkdownHandler
        )
      )
    }
  }
} satisfies FileProcessingProcessorRegistry
