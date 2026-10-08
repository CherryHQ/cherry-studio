import type { ImageModelV3File } from '@ai-sdk/provider'
import { convertImageModelFileToDataUri } from '@ai-sdk/provider-utils'

import { parseDataUrl } from '@shared/utils/dataUrl'

/**
 * Normalize an AI SDK file into the wire-format used by image transports.
 * provider-utils currently prefixes string data as raw base64, so preserve
 * complete data URLs before delegating byte encoding to its shared helper.
 */
export function fileToDataUrl(file: ImageModelV3File): string {
  if (file.type === 'file' && typeof file.data === 'string' && parseDataUrl(file.data)) return file.data
  return convertImageModelFileToDataUri(file)
}
