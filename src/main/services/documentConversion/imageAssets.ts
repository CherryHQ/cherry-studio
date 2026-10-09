import { constants, lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { exportErrorCodes } from '@shared/ipc/errors/export'

import { DocumentConversionError } from './DocumentConversionError'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export async function readImageAsset(
  source: string,
  options: { sourcePath?: string; assetRoot?: string },
  signal?: AbortSignal
): Promise<Buffer> {
  signal?.throwIfAborted()
  let bytes: Buffer
  if (/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/i.test(source)) {
    if (source.length > MAX_IMAGE_BYTES * 1.4) throw new Error('Image exceeds the 10 MB limit')
    bytes = Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')
  } else if (/^https?:\/\//i.test(source)) {
    throw new DocumentConversionError(
      exportErrorCodes.INVALID_IMAGE,
      'Remote images are not downloaded. Use an embedded image or a file inside the authorized document directory.',
      source
    )
  } else {
    const root = options.assetRoot ?? (options.sourcePath ? path.dirname(options.sourcePath) : undefined)
    if (!root || (/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith('file:'))) {
      throw new DocumentConversionError(
        exportErrorCodes.INVALID_IMAGE,
        'Local images require a document source directory.',
        source
      )
    }
    const sourceDirectory = options.sourcePath ? path.dirname(options.sourcePath) : root
    const candidate = source.startsWith('file:')
      ? fileURLToPath(source)
      : path.resolve(sourceDirectory, decodeURIComponent(source))
    const [realRoot, realSource] = await Promise.all([realpath(root), realpath(candidate)])
    const relative = path.relative(realRoot, realSource)
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new DocumentConversionError(
        exportErrorCodes.INVALID_IMAGE,
        'Image is outside the document directory.',
        source
      )
    }
    const handle = await open(realSource, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new Error('Image must be a regular file under 10 MB')
      const buffer = Buffer.alloc(info.size + 1)
      let size = 0
      while (size < buffer.length) {
        signal?.throwIfAborted()
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null)
        if (!bytesRead) break
        size += bytesRead
      }
      const [finalInfo, finalPath, finalRoot] = await Promise.all([
        lstat(realSource),
        realpath(candidate),
        realpath(root)
      ])
      if (
        size !== info.size ||
        finalInfo.dev !== info.dev ||
        finalInfo.ino !== info.ino ||
        finalInfo.mtimeMs !== info.mtimeMs ||
        finalPath !== realSource ||
        finalRoot !== realRoot
      ) {
        throw new Error('Image changed while being read')
      }
      bytes = buffer.subarray(0, size)
    } finally {
      await handle.close()
    }
  }
  return normalizeDocumentImage(bytes, signal)
}

export async function normalizeDocumentImage(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted()
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 10 MB limit')
  const signature = bytes.subarray(0, 12)
  if (
    !(
      signature.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])) ||
      signature.subarray(0, 2).equals(Buffer.from([255, 216])) ||
      signature.subarray(0, 3).toString() === 'GIF' ||
      (signature.toString().startsWith('RIFF') && signature.toString().endsWith('WEBP')) ||
      /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.subarray(0, 1024).toString())
    )
  ) {
    throw new DocumentConversionError(
      exportErrorCodes.INVALID_IMAGE,
      'Only PNG, JPEG, GIF, WebP and SVG images are supported.',
      ''
    )
  }
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.subarray(0, 1024).toString())) {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(bytes.toString(), { contentType: 'image/svg+xml' })
    try {
      const svg: Element = dom.window.document.documentElement
      const unsafe = Array.from(svg.querySelectorAll('*')).some(
        (element) =>
          ['script', 'foreignObject'].includes(element.localName) ||
          Array.from(element.attributes).some(
            (attribute) =>
              /^on/i.test(attribute.name) || (attribute.localName === 'href' && !attribute.value.startsWith('#'))
          )
      )
      if (unsafe || /url\(\s*['"]?(?!#)/i.test(svg.outerHTML) || /<!DOCTYPE|<!ENTITY/i.test(bytes.toString())) {
        throw new DocumentConversionError(
          exportErrorCodes.INVALID_IMAGE,
          'SVG images must contain only static shapes and local fragment references.',
          ''
        )
      }
    } finally {
      dom.window.close()
    }
  }
  const { default: sharp } = await import('sharp')
  const png = await sharp(bytes, { limitInputPixels: 16_000_000 }).png().toBuffer()
  signal?.throwIfAborted()
  if (png.length > MAX_IMAGE_BYTES) throw new Error('Decoded image exceeds the 10 MB limit')
  return png
}
