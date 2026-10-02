import Module from 'node:module'
import { Writable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import winston from 'winston'

const { loadBinding, logsDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return {
    loadBinding: vi.fn(),
    logsDir: mkdtempSync(join(tmpdir(), 'content-hash-loading-test-')) as string
  }
})

vi.unmock('@logger')
vi.unmock('winston')
vi.unmock('winston-daily-rotate-file')
vi.mock('@main/core/paths/constants', () => ({ LOGS_DIR: logsDir }))
vi.mock('@main/core/platform', () => ({ isDev: false }))

const moduleLoader = Module as unknown as {
  _load: (id: string, parent: unknown, isMain: boolean) => unknown
}

describe('content hash native loading diagnostics', () => {
  let baseLogger: winston.Logger
  let lines: string[]

  beforeEach(async () => {
    vi.resetModules()
    loadBinding.mockReset()
    const { loggerService } = await import('@logger')
    baseLogger = loggerService.getBaseLogger()
    baseLogger.clear()
    lines = []
    baseLogger.add(
      new winston.transports.Stream({
        stream: new Writable({
          write(chunk, _encoding, callback) {
            lines.push(String(chunk))
            callback()
          }
        })
      })
    )
    const originalLoad = moduleLoader._load
    vi.spyOn(moduleLoader, '_load').mockImplementation((id, parent, isMain) =>
      id === '@node-rs/xxhash' ? loadBinding() : originalLoad(id, parent, isMain)
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    baseLogger.close()
  })

  it('preserves underlying loader errors in serialized logs before propagating startup failure', async () => {
    const blocked = Object.assign(new Error('A policy blocked xxhash.win32-x64-msvc.node'), {
      code: 'ERR_DLOPEN_FAILED',
      requestBodyValues: { content: 'private file contents' }
    })
    const missing = Object.assign(new Error('Cannot find module ./xxhash.win32-x64-msvc.node', { cause: blocked }), {
      code: 'MODULE_NOT_FOUND'
    })
    const error = new Error('Cannot find native binding', { cause: missing })
    loadBinding.mockImplementation(() => {
      throw error
    })

    await expect(import('../contentHash')).rejects.toBe(error)
    await new Promise((resolve) => setImmediate(resolve))

    const entry = JSON.parse(lines[0])
    expect(entry).toMatchObject({
      module: 'ContentHash',
      appver: '1.0.0',
      data: [
        {
          platform: process.platform,
          arch: process.arch,
          node: process.versions.node,
          loadErrors: [
            { message: missing.message, code: 'MODULE_NOT_FOUND' },
            { message: blocked.message, code: 'ERR_DLOPEN_FAILED' }
          ]
        }
      ]
    })
    expect(lines.join('')).not.toContain('private file contents')
  })

  it('logs failures without nested causes and preserves the original exception', async () => {
    const error = new Error('Unsupported architecture')
    loadBinding.mockImplementation(() => {
      throw error
    })

    await expect(import('../contentHash')).rejects.toBe(error)
    await new Promise((resolve) => setImmediate(resolve))

    expect(JSON.parse(lines[0])).toMatchObject({
      errorMessage: 'Unsupported architecture',
      data: [{ loadErrors: [] }]
    })
  })
})
