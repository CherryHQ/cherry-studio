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

import iconv from 'iconv-lite'

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
  const bytes = data.isBase64 ? Buffer.from(data.data, 'base64') : decodePercentBytes(data.data)
  const charsetParameter = url
    .slice(5, url.indexOf(','))
    .split(';')
    .find((parameter) => /^\s*charset\s*=/i.test(parameter))
  if (charsetParameter) {
    const charset = charsetParameter
      .slice(charsetParameter.indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    // Do not guess when the sender explicitly declares an unsupported encoding.
    if (!iconv.encodingExists(charset)) return undefined
    return iconv.decode(bytes, charset)
  }
  try {
    // Statistical detection can misclassify short, valid UTF-8 as Latin-1.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return decodeTextWithAutoEncoding(bytes)
  }
}

/** Percent escapes are bytes, including in non-UTF-8 data URLs. */
function decodePercentBytes(value: string): Buffer {
  // Escapes shrink three ASCII code units to one byte. This is an upper bound
  // even for literal Unicode, and keeps allocations independent of escape count.
  const bytes = Buffer.allocUnsafe(Buffer.byteLength(value))
  let offset = 0
  let start = 0
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '%') continue
    if (index > start) offset += bytes.write(value.slice(start, index), offset)
    const escape = value.slice(index + 1, index + 3)
    if (!/^[\da-f]{2}$/i.test(escape)) throw new URIError('Malformed data URL percent escape')
    bytes[offset++] = Number.parseInt(escape, 16)
    index += 2
    start = index + 1
  }
  if (start < value.length) offset += bytes.write(value.slice(start), offset)
  return bytes.subarray(0, offset)
}
