import type { ByteRange } from './segmentedDownload'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface DownloadProbe {
  /** URL after redirects; the segment requests must use this one. */
  finalUrl: string
  totalBytes: number
  supportsRanges: boolean
  etag?: string
  lastModified?: string
  mime?: string
}

export class ProbeError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ProbeError'
  }
}

function header(response: Response, name: string): string | undefined {
  const value = response.headers.get(name)
  return value === null || value === '' ? undefined : value
}

function contentLength(response: Response): number | undefined {
  const raw = header(response, 'content-length')
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** `bytes 0-0/1234` → 1234; `bytes 0-0/*` → undefined. */
function totalFromContentRange(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(value.trim())
  if (!match) return undefined
  const total = Number(match[1])
  return Number.isSafeInteger(total) && total > 0 ? total : undefined
}

/** Asks for one byte to learn whether the server honours `Range`. */
async function probeRange(
  url: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal
): Promise<Pick<DownloadProbe, 'totalBytes' | 'supportsRanges'> & { etag?: string; lastModified?: string }> {
  const response = await fetchImpl(url, {
    headers: { Range: 'bytes=0-0' },
    redirect: 'follow',
    signal
  })
  const etag = header(response, 'etag')
  const lastModified = header(response, 'last-modified')
  if (response.status === 206) {
    const total = totalFromContentRange(header(response, 'content-range')) ?? contentLength(response)
    await response.body?.cancel()
    return { totalBytes: total ?? 0, supportsRanges: true, etag, lastModified }
  }
  // A server that ignores Range answers 200 with the whole body; do not drain it.
  await response.body?.cancel()
  return {
    totalBytes: contentLength(response) ?? 0,
    supportsRanges: false,
    etag,
    lastModified
  }
}

/**
 * Determines size, range support and validators before a task starts.
 *
 * HEAD is tried first because it costs no body; some servers reject it or omit
 * `Accept-Ranges`, so a one-byte `Range` request is the fallback and also the
 * way to confirm range support rather than trusting the header alone.
 */
export async function probeDownload(url: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<DownloadProbe> {
  let head: Response | undefined
  try {
    head = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal })
  } catch (error) {
    if (signal?.aborted) throw error
  }

  if (head?.ok) {
    const length = contentLength(head)
    const result: DownloadProbe = {
      finalUrl: head.url || url,
      totalBytes: length ?? 0,
      supportsRanges: false,
      etag: header(head, 'etag'),
      lastModified: header(head, 'last-modified'),
      mime: header(head, 'content-type')
    }
    await head.body?.cancel()
    if (length) {
      // `Accept-Ranges` is advisory: servers behind proxies and CDNs advertise
      // it while answering range requests with the whole body. Confirm with a
      // real one-byte range before segmenting; a failed confirmation degrades
      // to a single stream instead of trusting the header.
      const confirmed: Pick<DownloadProbe, 'totalBytes' | 'supportsRanges'> & {
        etag?: string
        lastModified?: string
      } = await probeRange(result.finalUrl, fetchImpl, signal).catch((error: unknown) => {
        if (signal?.aborted) throw error
        return { totalBytes: length, supportsRanges: false }
      })
      return {
        ...result,
        ...confirmed,
        finalUrl: result.finalUrl,
        etag: confirmed.etag ?? result.etag,
        lastModified: confirmed.lastModified ?? result.lastModified
      }
    }
  }

  const ranged = await probeRange(url, fetchImpl, signal)
  const response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal }).catch(() => undefined)
  return {
    finalUrl: response?.url || url,
    totalBytes: ranged.totalBytes,
    supportsRanges: ranged.supportsRanges,
    etag: ranged.etag,
    lastModified: ranged.lastModified,
    mime: response ? header(response, 'content-type') : undefined
  }
}

/** Builds the `Range` + `If-Range` headers for one segment attempt. */
export function segmentHeaders(range: ByteRange, offset: number, probe: DownloadProbe): Record<string, string> {
  const headers: Record<string, string> = { Range: `bytes=${offset}-${range.end - 1}` }
  if (probe.etag) headers['If-Range'] = probe.etag
  else if (probe.lastModified) headers['If-Range'] = probe.lastModified
  return headers
}
