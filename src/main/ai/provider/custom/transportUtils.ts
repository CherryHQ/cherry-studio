import type { ImageModelV3File } from '@ai-sdk/provider'
import { convertUint8ArrayToBase64 } from '@ai-sdk/provider-utils'
import { parseDataUrl } from '@shared/utils/dataUrl'

/**
 * Normalize an AI SDK file into the wire-format used by image transports.
 * provider-utils currently prefixes string data as raw base64, so preserve
 * complete data URLs before delegating byte encoding to its shared helper.
 */
export function fileToDataUrl(file: ImageModelV3File): string {
  if (file.type === 'url') return file.url
  if (typeof file.data === 'string') {
    const parsed = parseDataUrl(file.data)
    return parsed ? file.data : `data:${file.mediaType || 'image/png'};base64,${file.data}`
  }
  return `data:${file.mediaType || 'image/png'};base64,${convertUint8ArrayToBase64(file.data)}`
}
