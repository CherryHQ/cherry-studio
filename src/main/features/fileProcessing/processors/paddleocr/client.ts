import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { MB } from '@shared/config/constant'
import { net } from 'electron'

export const PADDLE_MAX_FILE_SIZE = 50 * MB

let paddleOcrClientCtorPromise: Promise<(typeof import('@paddleocr/api-sdk'))['PaddleOCRClient']> | undefined

async function getPaddleOcrClientCtor(): Promise<(typeof import('@paddleocr/api-sdk'))['PaddleOCRClient']> {
  paddleOcrClientCtorPromise ??= import('@paddleocr/api-sdk')
    .then((module) => module.PaddleOCRClient)
    .catch((error) => {
      throw new Error(
        `PaddleOCR SDK is unavailable at runtime: ${error instanceof Error ? error.message : String(error)}`
      )
    })

  return await paddleOcrClientCtorPromise
}

/** Creates a PaddleOCR API client with SSRF-safe Electron fetch behavior. */
export async function createPaddleClient(apiHost: string, apiKey: string) {
  const PaddleOCRClient = await getPaddleOcrClientCtor()
  const safeFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    return net.fetch(sanitizeRemoteUrl(url, apiHost), {
      ...init,
      redirect: 'error'
    } as RequestInit) as unknown as ReturnType<typeof fetch>
  }

  return new PaddleOCRClient({ token: apiKey, baseUrl: apiHost, fetch: safeFetch })
}
