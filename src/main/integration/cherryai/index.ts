/**
 * CherryAI API request signature module.
 *
 * De-obfuscated from index.js per @kangfenmao's request.
 * TODO: This file should be re-obfuscated before release.
 */
import { createHmac } from 'node:crypto'

import { CLIENT_SECRET } from './config'

const CLIENT_ID = 'cherry-studio'
const CLIENT_SECRET_SUFFIX = 'GvI6I5ZrEHcGOWjO5AKhJKGmnwwGfM62XKpWqkjhvzRU2NZIinM77aTGIqhqys0g'

function getClientSecret(): string {
  return CLIENT_SECRET + '.' + CLIENT_SECRET_SUFFIX
}

export interface SignatureOptions {
  method: string
  path: string
  query?: string
  body?: string | Record<string, unknown>
}

export interface SignatureHeaders {
  'X-Client-ID': string
  'X-Timestamp': string
  'X-Signature': string
}

export class SignatureClient {
  private clientId: string
  private clientSecret: string

  constructor(clientId?: string, clientSecret?: string) {
    this.clientId = clientId || CLIENT_ID
    this.clientSecret = clientSecret || getClientSecret()
    this.generateSignature = this.generateSignature.bind(this)
  }

  generateSignature(options: SignatureOptions): SignatureHeaders {
    const { method, path, query = '', body = '' } = options
    const timestamp = Math.floor(Date.now() / 1000).toString()

    let bodyString = ''
    if (body) {
      bodyString = typeof body === 'object' ? JSON.stringify(body) : body.toString()
    }

    const signatureString = [method.toUpperCase(), path, query, this.clientId, timestamp, bodyString].join('\n')

    const hmac = createHmac('sha256', this.clientSecret)
    hmac.update(signatureString)
    const signature = hmac.digest('hex')

    return {
      'X-Client-ID': this.clientId,
      'X-Timestamp': timestamp,
      'X-Signature': signature
    }
  }
}

let signatureClient: SignatureClient | null = null

export function generateSignature(options: SignatureOptions): SignatureHeaders {
  if (!signatureClient) {
    signatureClient = new SignatureClient()
  }
  return signatureClient.generateSignature(options)
}
