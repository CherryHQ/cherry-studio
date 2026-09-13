import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'

import JSZip from 'jszip'
import sharp from 'sharp'

export type FileEvidenceType = 'file' | 'image' | 'pptx' | 'text'

export interface FileEvidenceOptions {
  type: FileEvidenceType
  minimumBytes?: number
  expectedText?: string
  exactSlides?: number
}

export async function validateFileEvidence(filePath: string, options: FileEvidenceOptions): Promise<unknown> {
  const stats = statSync(filePath)
  if (!stats.isFile()) throw new Error(`Evidence path is not a file: ${filePath}`)
  const minimumBytes = options.minimumBytes ?? 1
  if (stats.size < minimumBytes) throw new Error(`Evidence file is smaller than ${minimumBytes} bytes: ${filePath}`)

  const bytes = readFileSync(filePath)
  const baseDetails = {
    bytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
  if (options.type === 'text') {
    const text = bytes.toString('utf8')
    if (options.expectedText && !text.includes(options.expectedText)) {
      throw new Error(`Evidence file does not contain the expected text: ${filePath}`)
    }
    return { ...baseDetails, expectedTextFound: Boolean(options.expectedText) }
  }

  if (options.type === 'image') {
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    const isWebp =
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    if (!isPng && !isJpeg && !isWebp) throw new Error(`Unsupported or damaged image evidence: ${filePath}`)
    const image = sharp(bytes)
    const [metadata, channelStats] = await Promise.all([image.metadata(), image.stats()])
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    const isBlank = channelStats.channels.every(({ stdev }) => stdev < 1)
    if (width < 64 || height < 64 || isBlank) throw new Error(`Image evidence is blank or too small: ${filePath}`)
    return { ...baseDetails, format: isPng ? 'png' : isJpeg ? 'jpeg' : 'webp', height, width }
  }

  if (options.type === 'pptx') {
    if (extname(filePath).toLowerCase() !== '.pptx') throw new Error(`Expected a .pptx evidence file: ${filePath}`)
    const archive = await JSZip.loadAsync(bytes)
    const slideNames = Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    if (!archive.file('[Content_Types].xml') || slideNames.length === 0) {
      throw new Error(`Invalid or empty PPTX evidence: ${filePath}`)
    }
    if (options.exactSlides !== undefined && slideNames.length !== options.exactSlides) {
      throw new Error(`Expected ${options.exactSlides} PPTX slides, found ${slideNames.length}: ${filePath}`)
    }
    if (options.expectedText) {
      const slideXml = (await Promise.all(slideNames.map((name) => archive.file(name)!.async('text')))).join('\n')
      if (!slideXml.includes(options.expectedText)) {
        throw new Error(`PPTX evidence does not contain the expected title: ${filePath}`)
      }
    }
    return { ...baseDetails, slides: slideNames.length }
  }

  return baseDetails
}
