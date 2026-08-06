const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50
const ZIP_EOCD_MIN_BYTES = 22
const ZIP_CENTRAL_FILE_HEADER_BYTES = 46
const ZIP_MAX_COMMENT_BYTES = 0xffff
const ZIP_UINT16_MAX = 0xffff
const ZIP_UINT32_MAX = 0xffffffff

const DOCX_ZIP_MAX_ENTRIES = 4000
const DOCX_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 32 * 1024 * 1024
const DOCX_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const SAFE_HYPERLINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export type DocxPreviewHtml = {
  readonly bodyHtml: string
  readonly styleHtml: string
}

const findEndOfCentralDirectory = (view: DataView) => {
  const minOffset = Math.max(0, view.byteLength - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES)

  for (let offset = view.byteLength - ZIP_EOCD_MIN_BYTES; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === view.byteLength) return offset
  }

  throw new Error('DOCX preview requires a valid ZIP archive')
}

const assertDocxZipLimits = (bytes: Uint8Array) => {
  if (bytes.byteLength < ZIP_EOCD_MIN_BYTES) throw new Error('DOCX preview requires a valid ZIP archive')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(view)
  const diskNumber = view.getUint16(eocdOffset + 4, true)
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true)
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true)
  const entryCount = view.getUint16(eocdOffset + 10, true)
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('DOCX preview does not support multi-disk ZIP archives')
  }
  if (
    entryCount === ZIP_UINT16_MAX ||
    centralDirectorySize === ZIP_UINT32_MAX ||
    centralDirectoryOffset === ZIP_UINT32_MAX
  ) {
    throw new Error('DOCX preview does not support ZIP64 archives')
  }
  if (entryCount > DOCX_ZIP_MAX_ENTRIES) {
    throw new Error(`DOCX preview supports ZIP archives with up to ${DOCX_ZIP_MAX_ENTRIES} entries`)
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize
  if (centralDirectoryEnd > eocdOffset || centralDirectoryEnd < centralDirectoryOffset) {
    throw new Error('DOCX preview requires a valid ZIP central directory')
  }

  let cursor = centralDirectoryOffset
  let totalUncompressedBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + ZIP_CENTRAL_FILE_HEADER_BYTES > centralDirectoryEnd ||
      view.getUint32(cursor, true) !== ZIP_CENTRAL_FILE_HEADER_SIGNATURE
    ) {
      throw new Error('DOCX preview requires a valid ZIP central directory')
    }

    const compressedBytes = view.getUint32(cursor + 20, true)
    const uncompressedBytes = view.getUint32(cursor + 24, true)
    const fileNameLength = view.getUint16(cursor + 28, true)
    const extraFieldLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const diskStart = view.getUint16(cursor + 34, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)

    if (
      compressedBytes === ZIP_UINT32_MAX ||
      uncompressedBytes === ZIP_UINT32_MAX ||
      localHeaderOffset === ZIP_UINT32_MAX
    ) {
      throw new Error('DOCX preview does not support ZIP64 archives')
    }
    if (diskStart !== 0) throw new Error('DOCX preview does not support multi-disk ZIP archives')
    if (uncompressedBytes > DOCX_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error('DOCX preview contains an entry that is too large')
    }

    totalUncompressedBytes += uncompressedBytes
    if (totalUncompressedBytes > DOCX_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('DOCX preview expands beyond the safe size limit')
    }

    cursor += ZIP_CENTRAL_FILE_HEADER_BYTES + fileNameLength + extraFieldLength + commentLength
    if (cursor > centralDirectoryEnd) throw new Error('DOCX preview requires a valid ZIP central directory')
  }

  if (cursor !== centralDirectoryEnd) throw new Error('DOCX preview requires a valid ZIP central directory')
}

const sanitizeDocxPreview = (container: HTMLElement) => {
  container.querySelectorAll('script, iframe, object, embed').forEach((element) => element.remove())
  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? ''
    let protocol: string | undefined
    try {
      protocol = new URL(href, 'https://docx-preview.invalid/').protocol
    } catch {
      protocol = undefined
    }
    if (!protocol || !SAFE_HYPERLINK_PROTOCOLS.has(protocol)) anchor.removeAttribute('href')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })
}

export const renderDocxPreviewHtml = async (blob: Blob): Promise<DocxPreviewHtml> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assertDocxZipLimits(bytes)

  const stagingHost = document.createElement('div')
  const styleContainer = document.createElement('div')
  const bodyContainer = document.createElement('div')
  stagingHost.setAttribute('aria-hidden', 'true')
  stagingHost.style.cssText = 'position:fixed;top:0;left:-99999px;visibility:hidden;pointer-events:none;'
  stagingHost.append(styleContainer, bodyContainer)
  document.body.appendChild(stagingHost)

  try {
    const { renderAsync } = await import('docx-preview')
    await renderAsync(bytes, bodyContainer, styleContainer, {
      breakPages: true,
      className: 'docx-preview',
      ignoreLastRenderedPageBreak: true,
      inWrapper: true,
      renderAltChunks: false,
      renderEndnotes: true,
      renderFooters: true,
      renderFootnotes: true,
      renderHeaders: true,
      useBase64URL: true
    })
    sanitizeDocxPreview(bodyContainer)
    return { bodyHtml: bodyContainer.innerHTML, styleHtml: styleContainer.innerHTML }
  } finally {
    stagingHost.remove()
  }
}
