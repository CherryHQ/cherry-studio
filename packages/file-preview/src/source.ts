export interface PreviewSource {
  id: string
  name: string
  mediaType?: string
  open(signal?: AbortSignal): Promise<PreviewDocument>
}

export interface PreviewDocument {
  size: number
  revision: string
  readRange(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>
  close(): Promise<void>
}

export type PreviewErrorCode = 'invalid_range' | 'short_read' | 'source_changed' | 'closed' | 'too_large' | 'load_error'

export class PreviewError extends Error {
  constructor(
    readonly code: PreviewErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'PreviewError'
  }
}

export function assertPreviewRange(size: number, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    offset > size ||
    length > size - offset
  ) {
    throw new PreviewError('invalid_range', `Invalid preview range: ${offset} + ${length} of ${size}`)
  }
}

export async function readPreviewRange(
  document: PreviewDocument,
  offset: number,
  length: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  assertPreviewRange(document.size, offset, length)
  signal?.throwIfAborted()
  const bytes = await document.readRange(offset, length, signal)
  signal?.throwIfAborted()
  if (bytes.byteLength !== length) {
    throw new PreviewError('short_read', `Short preview read: expected ${length} bytes, received ${bytes.byteLength}`)
  }
  return bytes
}

export async function readPreviewDocument(
  document: PreviewDocument,
  maxBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  assertPreviewRange(document.size, 0, document.size)
  if (document.size > maxBytes) {
    throw new PreviewError('too_large', `Preview source exceeds ${maxBytes} bytes`)
  }
  const bytes = await readPreviewRange(document, 0, document.size, signal)
  // Copy only a shared-memory view; whole documents can be tens of MiB.
  return bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes)
}
