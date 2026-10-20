import { parseDataUrl } from '@shared/utils/dataUrl'

/**
 * LM Studio's OpenAI-compatible endpoint expects image data as bare base64 when
 * more than one image is present in a message, while the OpenAI format uses a
 * data URI. Keep the workaround scoped to multi-image messages so single-image
 * requests retain their existing wire format.
 */
export function transformLmStudioRequestBody(args: Record<string, any>): Record<string, any> {
  if (!Array.isArray(args.messages)) return args

  let changed = false
  const messages = args.messages.map((message: any) => {
    if (!Array.isArray(message?.content)) return message

    const imageCount = message.content.filter((part: any) => part?.type === 'image_url').length
    if (imageCount < 2) return message

    let messageChanged = false
    const content = message.content.map((part: any) => {
      const url = part?.image_url?.url
      if (part?.type !== 'image_url' || typeof url !== 'string') return part

      const parsed = parseDataUrl(url)
      if (!parsed?.isBase64 || !parsed.mediaType?.toLowerCase().startsWith('image/')) return part

      messageChanged = true
      changed = true
      return { ...part, image_url: { ...part.image_url, url: parsed.data } }
    })

    return messageChanged ? { ...message, content } : message
  })

  return changed ? { ...args, messages } : args
}
