import { parseArgs } from 'node:util'

import WebSocket from 'ws'

import { selectMainTarget, validateConnection } from './connection'
import { createVoiceRuntimeSmokeExpression } from './rendererExpression'

async function evaluate(socketUrl: string, expression: string): Promise<unknown> {
  const socket = new WebSocket(socketUrl, { handshakeTimeout: 5000, maxPayload: 1024 * 1024 })
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP_TIMEOUT')), 425_000)
      const finish = (value?: unknown, failed = false): void => {
        clearTimeout(timer)
        if (failed) reject(new Error('CDP_EVALUATION_FAILED'))
        else resolve(value)
      }
      socket.once('error', () => finish(undefined, true))
      socket.once('close', () => finish(undefined, true))
      socket.on('message', (data) => {
        let message: any
        try {
          message = JSON.parse(data.toString())
        } catch {
          return
        }
        if (message.id !== 1) return
        if (message.error || message.result?.exceptionDetails) finish(undefined, true)
        else finish(message.result?.result?.value)
      })
      socket.once('open', () =>
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
              expression,
              awaitPromise: true,
              returnByValue: true,
              userGesture: true,
              timeout: 420_000
            }
          }),
          (error) => {
            if (error) finish(undefined, true)
          }
        )
      )
    })
  } finally {
    socket.terminate()
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'cdp-endpoint': { type: 'string' },
      'expected-url': { type: 'string' },
      language: { type: 'string', default: 'en-US' }
    }
  })
  const endpoint = values['cdp-endpoint']
  const expectedUrl = values['expected-url']
  const language = values.language
  if (language !== 'en-US' && language !== 'zh-CN') throw new Error('INVALID_LANGUAGE')
  if (!endpoint || !expectedUrl) throw new Error('EXPLICIT_TARGET_REQUIRED')
  validateConnection(endpoint, expectedUrl)
  const response = await fetch(new URL('/json/list', endpoint), {
    signal: AbortSignal.timeout(5000),
    redirect: 'error'
  })
  if (!response.ok) throw new Error('CDP_DISCOVERY_FAILED')
  const socketUrl = selectMainTarget(await response.json(), endpoint, expectedUrl)
  const result = await evaluate(socketUrl, createVoiceRuntimeSmokeExpression(expectedUrl, language))
  if (typeof result !== 'object' || result === null || !('passed' in result) || typeof result.passed !== 'boolean') {
    throw new Error('INVALID_SMOKE_RESULT')
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.passed) process.exitCode = 1
}

void main().catch(() => {
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, passed: false, stage: 'connection', code: 'SMOKE_CONNECTION_FAILED' })}\n`
  )
  process.exitCode = 1
})
