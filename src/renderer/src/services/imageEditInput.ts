import type { ImageMessageBlock } from '@renderer/types/newMessage'

const VALID_IMAGE_SUBTYPES = new Set(['png', 'jpeg', 'webp', 'gif', 'bmp'])

function getImageMimeFromExtension(ext?: string): string {
  const subtype = ext?.replace(/^\./, '').toLowerCase()
  if (!subtype) {
    return 'image/png'
  }

  if (subtype === 'jpg') {
    return 'image/jpeg'
  }

  return VALID_IMAGE_SUBTYPES.has(subtype) ? `image/${subtype}` : 'image/png'
}

function normalizeEditableImageDataUrl(data: string, mime?: string, fallbackExt?: string): string {
  const match = data.match(/^data:([^;,]*);base64,(.*)$/s)
  if (!match) {
    return data
  }

  const mediaType = match[1].toLowerCase()
  const subtype = mediaType.startsWith('image/') ? mediaType.slice('image/'.length) : ''
  if (mediaType.startsWith('image/') && VALID_IMAGE_SUBTYPES.has(subtype)) {
    return data
  }

  const mimeType = mime?.toLowerCase()
  const normalizedMime =
    mimeType?.startsWith('image/') && VALID_IMAGE_SUBTYPES.has(mimeType.slice('image/'.length))
      ? mimeType
      : getImageMimeFromExtension(fallbackExt)

  return `data:${normalizedMime};base64,${match[2]}`
}

export async function getEditableImageInput(block: ImageMessageBlock): Promise<string | undefined> {
  if (block.file) {
    const ext = block.file.ext.startsWith('.') ? block.file.ext : `.${block.file.ext}`
    const image = await window.api.file.base64Image(block.file.id + ext)
    return normalizeEditableImageDataUrl(image.data, image.mime, ext)
  }

  return block.url
}
