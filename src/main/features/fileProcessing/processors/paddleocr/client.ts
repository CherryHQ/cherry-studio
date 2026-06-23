import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import type { PaddleOCRClient as PaddleOCRClientType } from '@paddleocr/api-sdk'
import { MB } from '@shared/utils/constants'
import { net } from 'electron'

export const PADDLE_MAX_FILE_SIZE = 50 * MB

type PaddleOcrClientLike = typeof PaddleOCRClientType

type PaddleOcrModuleLike = {
  PaddleOCRClient: PaddleOcrClientLike
}

let paddleOcrClientCtorPromise: Promise<PaddleOcrClientLike> | undefined

async function getPaddleOcrClientCtor(): Promise<PaddleOcrClientLike> {
  const ctorPromise =
    paddleOcrClientCtorPromise ??
    import('@paddleocr/api-sdk')
      .then((module) => (module as PaddleOcrModuleLike).PaddleOCRClient)
      .catch((error) => {
        throw new Error(
          `PaddleOCR SDK is unavailable at runtime: ${error instanceof Error ? error.message : String(error)}`
        )
      })

  paddleOcrClientCtorPromise = ctorPromise
  return await ctorPromise
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
