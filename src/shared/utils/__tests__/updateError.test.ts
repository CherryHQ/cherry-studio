import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'

import { createHttpError } from 'builder-util-runtime'
import { describe, expect, it } from 'vitest'

import { isMissingUpdateManifest } from '../updateError'

const releaseError = (body = '{"error":{"code":"manifest_missing"}}') => {
  const response = new IncomingMessage(new Socket())
  response.statusCode = 503
  response.statusMessage = 'Service Unavailable'
  return createHttpError(
    response,
    `method: GET url: https://releases.cherry-ai.com/beta-cn-mac.yml\n\n          Data:\n          ${body}\n          `
  )
}

describe('isMissingUpdateManifest', () => {
  it('recognizes SDK messages without relying on the error class', () => {
    const error = releaseError()
    expect(isMissingUpdateManifest(error)).toBe(true)
    expect(isMissingUpdateManifest(new Error(error.message))).toBe(true)
    expect(isMissingUpdateManifest({ message: error.message })).toBe(true)
  })

  it.each([null, undefined, 503, '503 manifest_missing', {}, { message: null }, { message: 503 }])(
    'ignores a rejection without a string message: %j',
    (error) => {
      expect(isMissingUpdateManifest(error)).toBe(false)
    }
  )

  it.each([
    [64 * 1024, true],
    [64 * 1024 + 1, false]
  ])('classifies a %i-character message within the parsing limit: %s', (length, expected) => {
    const body = (message: string) => JSON.stringify({ error: { code: 'manifest_missing', message } })
    const overhead = releaseError(body('')).message.length
    const error = releaseError(body('x'.repeat(length - overhead)))
    expect(isMissingUpdateManifest(error)).toBe(expected)
  })
})
