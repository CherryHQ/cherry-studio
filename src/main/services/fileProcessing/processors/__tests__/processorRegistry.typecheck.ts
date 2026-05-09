/**
 * This file is typechecked by `pnpm typecheck:node`. The `@ts-expect-error`
 * directives assert feature-specific handler output constraints.
 */

import type {
  FileProcessingCapabilityHandler,
  FileProcessingHandlerOutput,
  FileProcessingProcessorRegistry
} from '../types'

const validRegistry = {
  tesseract: {
    isAvailable: true,
    capabilities: {
      image_to_text: {
        prepare: () => ({
          mode: 'background',
          execute: async () => ({
            kind: 'text',
            text: 'recognized text'
          })
        })
      }
    }
  },
  system: {
    isAvailable: true,
    capabilities: {}
  },
  paddleocr: {
    isAvailable: true,
    capabilities: {}
  },
  ovocr: {
    isAvailable: () => true,
    capabilities: {}
  },
  mineru: {
    isAvailable: true,
    capabilities: {}
  },
  doc2x: {
    isAvailable: true,
    capabilities: {
      document_to_markdown: {
        prepare: () => ({
          mode: 'remote-poll',
          startRemote: async () => ({
            providerTaskId: 'provider-task-1',
            status: 'pending',
            progress: 0,
            remoteContext: {}
          }),
          pollRemote: async () => ({
            status: 'completed',
            output: {
              kind: 'markdown',
              markdownContent: '# done'
            }
          })
        })
      }
    }
  },
  mistral: {
    isAvailable: true,
    capabilities: {}
  },
  'open-mineru': {
    isAvailable: true,
    capabilities: {}
  }
} satisfies FileProcessingProcessorRegistry

const validImageToTextOutput: FileProcessingHandlerOutput<'image_to_text'> = {
  kind: 'text',
  text: 'recognized text'
}

const validDocumentToMarkdownOutput: FileProcessingHandlerOutput<'document_to_markdown'> = {
  kind: 'markdown',
  markdownContent: '# done'
}

type TypedRemoteContext = {
  stage: 'parsing' | 'exporting'
}

const validTypedRemoteContextHandler: FileProcessingCapabilityHandler<'document_to_markdown', TypedRemoteContext> = {
  prepare: () => ({
    mode: 'remote-poll',
    startRemote: async () => ({
      providerTaskId: 'provider-task-1',
      status: 'pending',
      progress: 0,
      remoteContext: {
        stage: 'parsing'
      }
    }),
    pollRemote: async (task) => ({
      status: 'processing',
      progress: 50,
      remoteContext: {
        stage: task.remoteContext.stage === 'parsing' ? 'exporting' : task.remoteContext.stage
      }
    })
  })
}

const validTypedRemoteContextRegistry = {
  ...validRegistry,
  doc2x: {
    isAvailable: true,
    capabilities: {
      document_to_markdown: validTypedRemoteContextHandler
    }
  }
} satisfies FileProcessingProcessorRegistry

const wrongMarkdownOutput = {
  kind: 'markdown' as const,
  markdownContent: '# wrong'
}

// @ts-expect-error - image_to_text handlers must return text output.
const invalidImageToTextOutput: FileProcessingHandlerOutput<'image_to_text'> = wrongMarkdownOutput

const wrongTextOutput = {
  kind: 'text' as const,
  text: 'wrong'
}

// @ts-expect-error - document_to_markdown handlers must return markdown/file output.
const invalidDocumentToMarkdownOutput: FileProcessingHandlerOutput<'document_to_markdown'> = wrongTextOutput

void validRegistry
void validTypedRemoteContextRegistry
void validImageToTextOutput
void validDocumentToMarkdownOutput
void invalidImageToTextOutput
void invalidDocumentToMarkdownOutput
