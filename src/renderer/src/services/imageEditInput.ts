import type { ImageMessageBlock } from '@renderer/types/newMessage'

export async function getEditableImageInput(block: ImageMessageBlock): Promise<string | undefined> {
  if (block.file) {
    const ext = block.file.ext.startsWith('.') ? block.file.ext : `.${block.file.ext}`
    const image = await window.api.file.base64Image(block.file.id + ext)
    return image.data
  }

  return block.url
}
