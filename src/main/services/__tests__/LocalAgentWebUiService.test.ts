import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type * as ProcessRunner from '@main/utils/processRunner'
import { LOCAL_AGENT_WEB_UI_IDS } from '@shared/types/managedTool'

import { LocalAgentWebUiService } from '../LocalAgentWebUiService'

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
        const token = process.env.QWEN_SERVER_TOKEN ?? require('node:crypto').randomUUID();
        const port = Number(args[args.indexOf('--port') + 1]);
        http.createServer((req, res) => {
          res.setHeader('Content-Type', 'text/html');
          if (req.url.startsWith('/auth')) {
            res.statusCode = req.headers.authorization === 'Bearer ' + token ? 200 : 401;
          }
          res.end('<html>Agent Web UI</html>');
        }).listen(port, '127.0.0.1', () => {
          if (args.includes('web')) {
            process.stdout.write('Kimi server: http://127.0.0.1:' + port + '/#token=');
            setTimeout(() => process.stdout.write(token + '\\n'), 20);
          }
        });
      `,
          '--',
          ...args
        ],
        options
      )
  }
})

let home: string
let service: LocalAgentWebUiService
const config = { protocol: 'acp' as const, enabled: true, args: [], env: {} }
beforeEach(async () => {
  BaseService.resetInstances()
  home = await mkdtemp(path.join(tmpdir(), 'agent-web-'))
  vi.mocked(application.getPath).mockReturnValue(home)
  service = new LocalAgentWebUiService()
})
afterEach(async () => {
  await Promise.all(LOCAL_AGENT_WEB_UI_IDS.map((id) => service.stop(id)))
  await rm(home, { recursive: true, force: true })
})

it('keeps agents isolated, reuses running servers and releases only the stopped agent port', async () => {
  const first = await service.start({ ...config, presetId: 'kimi' })
  const second = await service.start({ ...config, presetId: 'opencode' })
  expect(first.status).toBe('running')
  expect(second.url).not.toBe(first.url)
  expect(await service.start({ ...config, presetId: 'kimi' })).toEqual(first)
  await service.stop('kimi')
  await expect(fetch(first.url!)).rejects.toThrow()
  expect((await fetch(second.url!)).ok).toBe(true)
})

it.each(['qwen', 'kimi'])('passes %s authentication to the page via its URL fragment', async (presetId) => {
  const status = await service.start({ ...config, presetId })
  const url = new URL(status.url!)
  const token = new URLSearchParams(url.hash.slice(1)).get('token')
  expect(token).toBeTruthy()
  expect((await fetch(`${url.origin}/auth`)).status).toBe(401)
  expect((await fetch(`${url.origin}/auth`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
})

it('cancels in-flight and queued starts before stop resolves', async () => {
  const start = service.start({ ...config, presetId: 'kimi' })
  const queued = service.start({ ...config, presetId: 'kimi' })
  const results = Promise.allSettled([start, queued])
  await service.stop('kimi')
  expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected'])
  expect((await service.start({ ...config, presetId: 'kimi' })).status).toBe('running')
})

it('rejects a preset without a supported Web UI', async () => {
  await expect(service.start({ ...config, presetId: 'claude' })).rejects.toThrow('Unsupported Web UI agent')
})
