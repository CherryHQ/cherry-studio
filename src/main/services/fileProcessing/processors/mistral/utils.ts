import fs from 'node:fs/promises'
import path from 'node:path'

import type { FileMetadata } from '@types'

import type { ImageToTextHandlerOutput } from '../types'
import {
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
  document: MistralImageDocument
): Promise<MistralOcrResponse> {
  return context.client.ocr.process(
    {
      model: context.model ?? null,
      document,
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
