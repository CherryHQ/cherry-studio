import { Blob as NodeBlob } from 'node:buffer'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import type * as Lark from '@larksuiteoapi/node-sdk'

/**
 * A lightweight HttpInstance adapter for the Lark SDK using Node.js native fetch.
 * We use fetch instead of Electron's net.fetch because Lark SDK
 * sometimes sends GET requests with a body and non-ASCII header values,
 * both of which Electron's net.fetch rejects.
 */
export function createFeishuHttpInstance(): Lark.HttpInstance {
  async function doRequest(
    method: string,
    url: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The Lark HTTP adapter encodes endpoint-specific JSON, strings and multipart Buffers; each SDK endpoint owns its request shape.
    data?: unknown,
    opts?: Parameters<Lark.HttpInstance['request']>[0]
  ): Promise<any> {
    const headers = new Headers(opts?.headers)
    let body: string | FormData | undefined

    const isMultipart = headers.get('content-type')?.includes('multipart/form-data') ?? false

    if (data !== undefined && data !== null) {
      if (typeof data === 'string') {
        body = data
      } else if (data instanceof FormData) {
        body = data
      } else if (isMultipart) {
        // Upload endpoints (im.image.create / im.file.create) hand us a plain object with a
        // Buffer field and a boundary-less multipart header, expecting the http layer to build
        // the form (axios does this; native fetch does not). Build it ourselves and drop the
        // SDK's Content-Type so fetch can set one with a boundary.
        const form = new FormData()
        // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SDK upload endpoints own dynamic form fields and native Buffer values; this transport checks each entry before byte-preserving upload or string coercion.
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
          if (value === undefined || value === null) continue
          if (Buffer.isBuffer(value)) {
            const blob = new NodeBlob([value])
            // SAFETY: Node's global Blob is node:buffer.Blob; DOM typings narrow its bytes and stream declarations.
            form.append(key, blob as NodeBlob & Blob, key)
          } else {
            form.append(key, String(value))
          }
        }
        body = form
        headers.delete('content-type')
      } else {
        body = JSON.stringify(data)
        if (!headers.get('content-type')) {
          headers.set('content-type', 'application/json')
        }
      }
    }

    const fetchUrl = new URL(url)
    if (opts?.params) {
      for (const [key, value] of Object.entries(opts.params)) {
        fetchUrl.searchParams.set(key, String(value))
      }
    }

    const upperMethod = method.toUpperCase()

    // Use Node.js native fetch instead of Electron's net.fetch here because:
    // 1. net.fetch rejects GET requests with a body (Lark SDK sends payload on GET)
    // 2. net.fetch rejects header values with non-ASCII chars (Lark SDK sends Chinese filenames)
    const request: NonNullable<Parameters<typeof fetch>[1]> = {
      method: upperMethod,
      headers
    }
    if (upperMethod !== 'GET' && upperMethod !== 'HEAD' && body) request.body = body
    const res = await fetch(fetchUrl.toString(), request)

    const isStream = opts?.responseType === 'stream'
    const responseData = isStream
      ? res.body
        ? Readable.fromWeb(res.body as NodeReadableStream)
        : Readable.from([])
      : await res.text().then((text) => {
          if (!text) {
            return ''
          }

          try {
            return JSON.parse(text)
          } catch {
            return text
          }
        })
    const responseHeaders = Object.fromEntries(res.headers.entries())

    if (!res.ok) {
      const detail =
        typeof responseData === 'string'
          ? responseData
          : (responseData as { msg?: string; message?: string } | null)?.msg ||
            (responseData as { msg?: string; message?: string } | null)?.message ||
            res.statusText
      const error = new Error(`Feishu HTTP ${res.status}: ${detail}`)
      ;(error as Error & { response?: unknown }).response = {
        data: responseData,
        headers: responseHeaders,
        status: res.status,
        statusText: res.statusText
      }
      throw error
    }

    if (opts?.$return_headers) {
      return {
        data: responseData,
        headers: responseHeaders
      }
    }

    return responseData
  }

  return {
    request: (opts: any) => doRequest(opts.method || 'GET', opts.url, opts.data, opts),
    get: (url: string, opts?: any) => doRequest('GET', url, undefined, opts),
    delete: (url: string, opts?: any) => doRequest('DELETE', url, undefined, opts),
    head: (url: string, opts?: any) => doRequest('HEAD', url, undefined, opts),
    options: (url: string, opts?: any) => doRequest('OPTIONS', url, undefined, opts),
    post: (url: string, data?: any, opts?: any) => doRequest('POST', url, data, opts),
    put: (url: string, data?: any, opts?: any) => doRequest('PUT', url, data, opts),
    patch: (url: string, data?: any, opts?: any) => doRequest('PATCH', url, data, opts)
  }
}
