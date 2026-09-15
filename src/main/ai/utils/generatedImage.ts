import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { fileTypeFromBuffer } from 'file-type'
import * as z from 'zod'

import type { GeneratedImageRejectionReason } from '@shared/ai/paintingGenerateError'
import type { Base64String } from '@shared/types/file'

const GENERATED_IMAGE_BASE64_SCHEMA = z.base64()
const SVG_MEDIA_TYPE = 'image/svg+xml'
const RENDERABLE_IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  SVG_MEDIA_TYPE
])
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const SVG_COMMENT_OR_CDATA_PATTERN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g
const SVG_DOCTYPE_PATTERN = /<!DOCTYPE\b/i
const svgParser = new XMLParser({ ignoreAttributes: false, processEntities: false })

export type GeneratedImageCandidate = {
  base64?: string
  mediaType?: string
}

export type GeneratedImageValidationResult =
  | { data: Base64String; reason?: never }
  | { data?: never; reason: GeneratedImageRejectionReason }

function isValidSvgImage(data: Buffer): boolean {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(data)
    const markup = source.replace(SVG_COMMENT_OR_CDATA_PATTERN, '')
    if (SVG_DOCTYPE_PATTERN.test(markup) || XMLValidator.validate(source) !== true) return false

    const document = svgParser.parse(source)
    const roots = Object.keys(document).filter((key) => key !== '?xml')
    if (roots.length !== 1) return false

    const rootName = roots[0]
    const [prefix, localName] = rootName.includes(':') ? rootName.split(':') : ['', rootName]
    const root = localName === 'svg' ? document[rootName] : undefined
    const namespaceAttribute = prefix ? `@_xmlns:${prefix}` : '@_xmlns'
    return typeof root === 'object' && root !== null && root[namespaceAttribute] === SVG_NAMESPACE
  } catch {
    return false
  }
}

export async function validateGeneratedImage(
  candidate: GeneratedImageCandidate
): Promise<GeneratedImageValidationResult> {
  const mediaType = (candidate.mediaType || 'image/png').toLowerCase()
  if (!mediaType.startsWith('image/')) return { reason: 'unsupported_media_type' }
  if (!candidate.base64 || !GENERATED_IMAGE_BASE64_SCHEMA.safeParse(candidate.base64).success) {
    return { reason: 'invalid_image_data' }
  }

  try {
    const imageBytes = Buffer.from(candidate.base64, 'base64')
    const detectedType = await fileTypeFromBuffer(imageBytes)
    const detectedMediaType = detectedType?.mime.startsWith('image/')
      ? detectedType.mime
      : mediaType === SVG_MEDIA_TYPE && isValidSvgImage(imageBytes)
        ? SVG_MEDIA_TYPE
        : undefined
    if (!detectedMediaType) return { reason: 'invalid_image_data' }
    if (!RENDERABLE_IMAGE_MEDIA_TYPES.has(detectedMediaType)) return { reason: 'unsupported_media_type' }
    return { data: `data:${detectedMediaType};base64,${candidate.base64}` }
  } catch {
    return { reason: 'invalid_image_data' }
  }
}
