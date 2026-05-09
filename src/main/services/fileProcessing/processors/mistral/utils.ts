import fs from 'node:fs/promises'
import path from 'node:path'

import type { FileMetadata } from '@types'

import type { DocumentToMarkdownHandlerOutput, ImageToTextHandlerOutput } from '../types'
import {
  type MistralDocumentUrlDocument,
  type MistralImageDocument,
  type MistralOcrResponse,
  MistralOcrResponseSchema,
  type PreparedMistralContext
} from './types'

// TODO: Move file-type / mime resolution into the unified file management layer when file handling is consolidated.
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

export async function prepareDocumentPayload(context: PreparedMistralContext): Promise<MistralImageDocument> {
  return {
    type: 'image_url',
    imageUrl: await createImageDataUrl(context.file)
  }
}

export async function executeExtraction(
  context: PreparedMistralContext,
  document: MistralImageDocument | MistralDocumentUrlDocument,
  options: { tableFormat?: 'html' | 'markdown' } = {}
): Promise<MistralOcrResponse> {
  return context.client.ocr.process(
    {
      model: context.model ?? null,
      document,
      tableFormat: options.tableFormat,
      includeImageBase64: false
    },
    {
      signal: context.signal
    }
  )
}

export function parseMistralOcrResponse(response: MistralOcrResponse) {
  return MistralOcrResponseSchema.parse(response)
}

export function buildTextExtractionResult(response: MistralOcrResponse): ImageToTextHandlerOutput {
  const parsedResponse = parseMistralOcrResponse(response)
  const markdown = parsedResponse.pages
    .map((page) => page.markdown.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()

  if (!markdown) {
    throw new Error('Mistral OCR returned empty markdown content')
  }

  return {
    kind: 'text',
    text: markdown
  }
}

export function buildMarkdownConversionResult(response: MistralOcrResponse): DocumentToMarkdownHandlerOutput {
  const parsedResponse = parseMistralOcrResponse(response)
  const markdownContent = parsedResponse.pages
    .map((page) => page.markdown.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()

  if (!markdownContent) {
    throw new Error('Mistral OCR returned empty markdown content')
  }

  return {
    kind: 'markdown',
    markdownContent
  }
}

export async function uploadDocument(context: PreparedMistralContext): Promise<string> {
  const fileBuffer = await fs.readFile(context.file.path)
  const uploadedFile = await context.client.files.upload(
    {
      file: {
        fileName: context.file.origin_name || context.file.name,
        content: new Uint8Array(fileBuffer)
      },
      purpose: 'ocr'
    },
    {
      signal: context.signal
    }
  )

  return uploadedFile.id
}

export async function getUploadedDocumentSignedUrl(context: PreparedMistralContext, fileId: string): Promise<string> {
  const signedUrl = await context.client.files.getSignedUrl(
    {
      fileId
    },
    {
      signal: context.signal
    }
  )

  return signedUrl.url
}

export async function deleteUploadedDocument(context: PreparedMistralContext, fileId: string): Promise<void> {
  await context.client.files.delete(
    {
      fileId
    },
    {
      signal: context.signal
    }
  )
}

async function createImageDataUrl(file: FileMetadata): Promise<string> {
  const filePath = file.path
  const extension = (path.extname(filePath) || file.ext).toLowerCase()
  const mime = IMAGE_MIME_BY_EXTENSION[extension]

  if (!mime) {
    throw new Error(`Unsupported image type for Mistral OCR: ${extension || file.ext}`)
  }

  const buffer = await fs.readFile(filePath)
  return `data:${mime};base64,${buffer.toString('base64')}`
}
