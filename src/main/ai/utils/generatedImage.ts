import type { GeneratedImageRejectionReason } from '@shared/ai/paintingGenerateError'
import type { Base64String } from '@shared/types/file'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { fileTypeFromBuffer } from 'file-type'
import * as z from 'zod'

const GENERATED_IMAGE_BASE64_SCHEMA = z.base64()
const SVG_MEDIA_TYPE = 'image/svg+xml'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
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
    if (/<!DOCTYPE\b/i.test(source) || XMLValidator.validate(source) !== true) return false

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
  const mediaType = candidate.mediaType || 'image/png'
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
    return detectedMediaType
      ? { data: `data:${detectedMediaType};base64,${candidate.base64}` }
      : { reason: 'invalid_image_data' }
  } catch {
    return { reason: 'invalid_image_data' }
  }
}
