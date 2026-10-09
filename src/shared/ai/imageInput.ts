import { convertBase64ToUint8Array } from '@ai-sdk/provider-utils'
import { parseDataUrl } from '@shared/utils/dataUrl'
import * as z from 'zod'

const httpImageUrlSchema = z.url({ protocol: /^https?$/ })

function isImageInput(value: string): boolean {
  const dataUrl = parseDataUrl(value)
  if (dataUrl) {
    if (
      !dataUrl.isBase64 ||
      dataUrl.mediaType === undefined ||
      !/^image\/[a-z0-9][a-z0-9.+-]*$/i.test(dataUrl.mediaType)
    )
      return false
    try {
      return convertBase64ToUint8Array(dataUrl.data).byteLength > 0
    } catch {
      return false
    }
  }
  return httpImageUrlSchema.safeParse(value).success
}

/** Image IPC inputs are remote URLs or complete image data URLs, never local paths or raw base64. */
export const imageInputSchema = z
  .string()
  .refine(isImageInput, 'Expected an HTTP(S) image URL or base64 image data URL')
