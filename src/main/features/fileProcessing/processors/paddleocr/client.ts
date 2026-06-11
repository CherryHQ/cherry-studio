import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { PaddleOCRClient } from '@paddleocr/api-sdk'
import { net } from 'electron'

/** Creates a PaddleOCR API client with SSRF-safe Electron fetch behavior. */
export function createPaddleClient(apiHost: string, apiKey: string) {
  const safeFetch: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    return net.fetch(sanitizeRemoteUrl(url, apiHost), {
      ...init,
      redirect: 'error'
    } as RequestInit) as unknown as ReturnType<typeof fetch>
  }

  return new PaddleOCRClient({ token: apiKey, baseUrl: apiHost, fetch: safeFetch })
}
