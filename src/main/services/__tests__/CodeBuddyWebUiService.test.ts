import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type * as ProcessRunner from '@main/utils/processRunner'

import { CodeBuddyWebUiService } from '../CodeBuddyWebUiService'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@main/ai/runtime/localAgent/launch', () => ({
  resolveLocalAgentLaunch: async () => ({ executable: process.execPath, env: process.env })
}))
vi.mock('@main/utils/processRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessRunner>()
  return {
    ...actual,
    crossPlatformSpawn: (_command: string, args: string[], options: Parameters<typeof actual.crossPlatformSpawn>[2]) =>
      actual.crossPlatformSpawn(
        process.execPath,
        [
          '-e',
          `
        const http = require('node:http');
        const args = process.argv;
        http.createServer((req, res) => {
          if (req.url.startsWith('/auth')) {
            res.statusCode = new URL(req.url, 'http://localhost').searchParams.get('password') === process.env.CODEBUDDY_GATEWAY_PASSWORD ? 200 : 401;
          }
          res.end('<title>CodeBuddy Code Remote Control</title>');
        }).listen(Number(args[args.indexOf('--port') + 1]), '127.0.0.1');
      `,
          '--',
          ...args
        ],
        options
      )
  }
})

let home: string
let service: CodeBuddyWebUiService
let server: Server | undefined
const config = { presetId: 'codebuddy-code', protocol: 'acp' as const, enabled: true, args: [], env: {} }

beforeEach(async () => {
  BaseService.resetInstances()
  home = await mkdtemp(path.join(tmpdir(), 'codebuddy-web-'))
  vi.mocked(application.getPath).mockImplementation((key) =>
    key === 'sys.home' ? home : path.join(home, 'ports.json')
  )
  service = new CodeBuddyWebUiService()
})
afterEach(async () => {
  await service.stop()
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  await rm(home, { recursive: true, force: true })
})

async function externalServer(title: string) {
  server = createServer((_req, res) => res.end(`<title>${title}</title>`))
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No listening port')
  await writeFile(path.join(home, 'ports.json'), JSON.stringify({ ports: [address.port] }))
  return `http://127.0.0.1:${address.port}/`
}

it('reuses a recorded CodeBuddy Web UI without stopping the external service', async () => {
  const url = await externalServer('CodeBuddy Code Remote Control')
  expect(await service.getStatus()).toEqual({ status: 'running', owned: false, url })
  expect(await service.start(config)).toEqual({ status: 'running', owned: false, url })
  await service.stop()
  expect((await fetch(url)).ok).toBe(true)
})

it('starts an authenticated owned process when a recorded port belongs to another app, then releases it', async () => {
  const externalUrl = await externalServer('Unrelated app')
  const started = await service.start(config)
  expect(started).toMatchObject({ status: 'running', owned: true })
  const url = new URL(started.url!)
  expect(`${url.origin}/`).not.toBe(externalUrl)
  url.pathname = '/auth'
  expect((await fetch(url)).status).toBe(200)
  url.search = ''
  expect((await fetch(url)).status).toBe(401)
  expect(await service.start(config)).toEqual(started)
  await service.stop()
  await expect(fetch(url)).rejects.toThrow()
  expect((await fetch(externalUrl)).ok).toBe(true)
})

it('cancels queued starts when stop is requested', async () => {
  const starts = [service.start(config), service.start(config)]
  const results = Promise.allSettled(starts)
  await service.stop()
  expect(await results).toEqual([
    { status: 'rejected', reason: expect.any(Error) },
    { status: 'rejected', reason: expect.any(Error) }
  ])
  expect(await service.getStatus()).toEqual({ status: 'stopped', owned: false, url: undefined })
})
