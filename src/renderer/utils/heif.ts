import { ipcApi } from '@renderer/ipc'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle, fileUrlToPath } from '@shared/utils/file'

export interface HeifImageSource {
  source: string | Blob
  mediaType?: string
  filename?: string
}

export function isHeifImage({ source, mediaType, filename }: HeifImageSource): boolean {
  const mime = (mediaType || (source instanceof Blob ? source.type : '')).split(';', 1)[0].trim().toLowerCase()
  if (mime && mime !== 'application/octet-stream') return /^image\/hei[cf](?:-sequence)?$/.test(mime)
  const name = source instanceof File ? source.name : typeof source === 'string' ? source : ''
  return /\.hei[cf]$/i.test(filename ?? '') || /\.hei[cf]$/i.test(name)
}

/** Returns PNG bytes as a Blob; the caller owns any object URL it creates. */
export async function resolveHeifImage(source: string | Blob): Promise<Blob> {
  if (source instanceof Blob && source.size > 64 * 1024 * 1024) {
    throw new IpcError(fileErrorCodes.HEIF_TOO_LARGE)
  }
  const input =
    source instanceof Blob
      ? { kind: 'bytes' as const, content: new Uint8Array(await source.arrayBuffer()) }
      : createFilePathHandle(
          AbsoluteFilePathSchema.parse(source.startsWith('file:') ? fileUrlToPath(new URL(source)) : source)
        )
  const { content } = await ipcApi.request('file.get_heif_rendition', { source: input })
  return new Blob([content.slice()], { type: 'image/png' })
}

export function heifErrorKey(error: unknown): string {
  const code = error instanceof IpcError ? error.code : undefined
  switch (code) {
    case fileErrorCodes.HEIF_TOO_LARGE:
      return 'error.heif_detail_too_large'
    case fileErrorCodes.HEIF_UNAVAILABLE:
      return 'error.heif_detail_unavailable'
    case fileErrorCodes.HEIF_BUSY:
      return 'error.heif_detail_busy'
    case fileErrorCodes.HEIF_TIMEOUT:
      return 'error.heif_detail_timeout'
    default:
      return 'error.heif_detail_convert'
  }
}
