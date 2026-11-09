/**
 * Gateway protocol-conversion boundary: normalize external text files to text.
 *
 * External file parts arriving through gateway protocols (OpenAI Responses
 * `input_file`, Gemini `inlineData`) carry no Cherry `fileEntryId` — they are
 * not first-party attachments, so the chat attachment router's first-party
 * text extraction never sees them, and forwarding them to the provider as
 * `file` parts fails at adapter conversion for verified combinations: the
 * OpenAI Responses adapter rejects every `text/*` file part, and the Anthropic
 * adapter rejects every text media type except `text/plain`
 * (`UnsupportedFunctionalityError`, before dispatch). A `text` part is accepted
 * by every adapter, so a text file whose bytes are locally available (base64
 * payload or `data:` URL) is decoded here, at the protocol boundary.
 *
 * The content is inlined in full, uncapped: the gateway caller owns its
 * context window (`contextOwner: 'caller'` opts out of Cherry's shared
 * attachment budget), so no page-size cap and no `read_file` pointer apply.
 *
 * Files referenced by remote URL (`file_url` / `fileUri`) stay `file` parts:
 * protocol conversion does not fetch remote content.
 */

import { decodeTextWithAutoEncoding } from '@main/utils/legacyFile'
import { parseDataUrl } from '@shared/utils/dataUrl'

/**
 * Decode a `text/*` file part's locally-available bytes, auto-detecting the
 * encoding. Returns `undefined` when the part is not a text media type or its
 * bytes are not inline (remote URL), leaving the caller to keep the file part.
 */
export function inlineTextFileContent(mediaType: string, url: string): string | undefined {
  if (!mediaType.startsWith('text/')) return undefined
  const data = parseDataUrl(url)
  if (!data) return undefined
  const bytes = data.isBase64 ? Buffer.from(data.data, 'base64') : Buffer.from(decodeURIComponent(data.data))
  return decodeTextWithAutoEncoding(bytes)
}
