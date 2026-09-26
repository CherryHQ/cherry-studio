import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handleRequest: vi.fn(),
  requestWrite: vi.fn(),
  reportBinding: vi.fn(),
  diagnoseEndpoint: vi.fn()
}))

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-userdata-'))
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-outside-'))
afterAll(() => {
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

vi.mock('@application', async () => {
  const base = (await import('@test-mocks/main/application')).mockApplicationFactory({
    DataApiService: { getApiServer: () => ({ handleRequest: mocks.handleRequest }) },
    DoctorAgentService: {
      requestWrite: mocks.requestWrite,
      reportBindingForSession: mocks.reportBinding,
      reportForSession: vi.fn()
    },
    NetworkService: { diagnoseEndpoint: mocks.diagnoseEndpoint }
  } as never)
  return {
    ...base,
    application: {
      ...base.application,
      getPath: (key: string) => (key === 'app.logs' ? path.join(userData, 'logs') : userData)
    }
  }
})

import DoctorServer from '@main/ai/mcp/servers/doctor'

import { applyWrite, undoWrite, writeRisk } from '../doctorWrites'

async function connect() {
  const server = new DoctorServer('session-1')
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'doctor-test', version: '1.0.0' }, { capabilities: {} })
  await server.mcpServer.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

function text(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content.map((item) => item.text).join('\n')
}

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  mocks.requestWrite.mockResolvedValue({ status: 'proposed', proposal: { id: 'p1' } })
  mocks.reportBinding.mockReturnValue({ scope: 'global', reportRunId: 'run-1' })
})

describe('doctor data_api tool', () => {
  it('redacts credentials from GET responses', async () => {
    mocks.handleRequest.mockResolvedValue({
      id: 'x',
      status: 200,
      data: { id: 'openai', apiHost: 'https://api.openai.com', apiKeys: [{ key: 'sk-live-123' }] }
    })
    const client = await connect()
    const result = await client.callTool({ name: 'data_api', arguments: { method: 'GET', path: '/providers/openai' } })
    expect(text(result)).toContain('https://api.openai.com')
    expect(text(result)).not.toContain('sk-live-123')
    expect(mocks.handleRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/providers/openai' })
    )
    await client.close()
  })

  it('refuses PATCH outside the entity allowlist and never reaches the API', async () => {
    const client = await connect()
    const result = await client.callTool({
      name: 'data_api',
      arguments: { method: 'PATCH', path: '/topics/t1', body: { name: 'x' }, summary: 'rename' }
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('PATCH is not allowed')
    expect(mocks.handleRequest).not.toHaveBeenCalled()
    expect(mocks.requestWrite).not.toHaveBeenCalled()
    await client.close()
  })

  it('refuses a PATCH body that carries a credential field', async () => {
    const client = await connect()
    const result = await client.callTool({
      name: 'data_api',
      arguments: { method: 'PATCH', path: '/providers/openai', body: { apiKey: 'sk-1' }, summary: 'set key' }
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('credential')
    expect(mocks.requestWrite).not.toHaveBeenCalled()
    await client.close()
  })

  it('refuses a credential field nested inside an allowed map', async () => {
    const client = await connect()
    const result = await client.callTool({
      name: 'data_api',
      arguments: {
        method: 'PATCH',
        path: '/mcp-servers/s1',
        body: { env: { OPENAI_API_KEY: 'sk-1', DEBUG: '1' } },
        summary: 'set env'
      }
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('env.OPENAI_API_KEY')
    expect(mocks.requestWrite).not.toHaveBeenCalled()
    await client.close()
  })

  it('turns an allowed PATCH into a write request with the model summary', async () => {
    const client = await connect()
    const result = await client.callTool({
      name: 'data_api',
      arguments: {
        method: 'PATCH',
        path: '/providers/openai',
        body: { apiHost: 'https://api.openai.com/v1' },
        summary: 'Add the missing /v1 suffix'
      }
    })
    expect(result.isError).toBeFalsy()
    expect(mocks.requestWrite).toHaveBeenCalledWith(
      'session-1',
      { kind: 'data_api_patch', path: '/providers/openai', body: { apiHost: 'https://api.openai.com/v1' } },
      'Add the missing /v1 suffix'
    )
    await client.close()
  })
})

describe('doctor preference tool', () => {
  it('reads with secrets redacted and only writes allowlisted keys', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://user:secret@proxy:8080')
    const client = await connect()
    const get = await client.callTool({ name: 'preference', arguments: { action: 'get', key: 'app.proxy.url' } })
    expect(text(get)).not.toContain('secret')

    const denied = await client.callTool({
      name: 'preference',
      arguments: { action: 'set', key: 'app.language', value: 'en-US', summary: 'switch language' }
    })
    expect(denied.isError).toBe(true)
    expect(mocks.requestWrite).not.toHaveBeenCalled()

    const wrongType = await client.callTool({
      name: 'preference',
      arguments: { action: 'set', key: 'app.proxy.mode', value: 'yes', summary: 'x' }
    })
    expect(wrongType.isError).toBe(true)
    const withCredentials = await client.callTool({
      name: 'preference',
      arguments: { action: 'set', key: 'app.proxy.url', value: 'http://user:pw@proxy:8080', summary: 'x' }
    })
    expect(withCredentials.isError).toBe(true)
    expect(text(withCredentials)).toContain('credentials')
    expect(mocks.requestWrite).not.toHaveBeenCalled()

    await client.callTool({
      name: 'preference',
      arguments: { action: 'set', key: 'app.proxy.mode', value: 'system', summary: 'use the system proxy' }
    })
    expect(mocks.requestWrite).toHaveBeenCalledWith(
      'session-1',
      { kind: 'preference_set', key: 'app.proxy.mode', value: 'system' },
      'use the system proxy'
    )
    await client.close()
  })
})

describe('doctor doctor_fix tool', () => {
  it('binds the fix to the report the panel shows and rejects undeclared fixes', async () => {
    const client = await connect()
    const unknown = await client.callTool({
      name: 'doctor_fix',
      arguments: { checkId: 'network-online', fixId: 'reconnect', summary: 'reconnect' }
    })
    expect(unknown.isError).toBe(true)
    expect(mocks.requestWrite).not.toHaveBeenCalled()

    await client.callTool({
      name: 'doctor_fix',
      arguments: { checkId: 'mcp-servers-connected', fixId: 'restart', target: 'srv-1', summary: 'restart srv-1' }
    })
    expect(mocks.requestWrite).toHaveBeenCalledWith(
      'session-1',
      {
        kind: 'doctor_fix',
        request: {
          scope: 'global',
          runId: 'run-1',
          checkId: 'mcp-servers-connected',
          fixId: 'restart',
          target: 'srv-1'
        }
      },
      'restart srv-1'
    )
    await client.close()
  })
})

describe('doctor read_file tool', () => {
  it('tails a log with secrets redacted and lists directories', async () => {
    fs.mkdirSync(path.join(userData, 'logs'), { recursive: true })
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i} Authorization: Bearer tok-${i}`)
    fs.writeFileSync(path.join(userData, 'logs', 'main.log'), lines.join('\n'))
    const client = await connect()
    const tail = await client.callTool({ name: 'read_file', arguments: { path: 'logs/main.log', lines: 5 } })
    const body = JSON.parse(text(tail))
    expect(body.text.split('\n')).toHaveLength(5)
    expect(body.text).toContain('line 299')
    expect(body.text).not.toContain('tok-299')

    const listing = await client.callTool({ name: 'read_file', arguments: { path: 'logs' } })
    expect(JSON.parse(text(listing)).entries).toEqual([{ name: 'main.log', kind: 'file', size: expect.any(Number) }])
    await client.close()
  })

  it.each([
    ['a path outside userData', path.join(outside, 'x.txt')],
    ['a traversal', '../escape.txt'],
    ['user content', 'Data/Files/upload.pdf'],
    ['a credential file', 'Data/Mcp/credentials.json']
  ])('refuses %s', async (_label, target) => {
    const client = await connect()
    const result = await client.callTool({ name: 'read_file', arguments: { path: target } })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Access denied')
    await client.close()
  })

  it('refuses a symlink inside userData that points outside', async () => {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope')
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(userData, 'link.txt'))
    const client = await connect()
    const result = await client.callTool({ name: 'read_file', arguments: { path: 'link.txt' } })
    expect(result.isError).toBe(true)
    expect(text(result)).not.toContain('nope')
    await client.close()
  })
})

describe('applyWrite / undoWrite guards', () => {
  const patch = { kind: 'data_api_patch', path: '/mcp-servers/s1', body: { env: { DEBUG: '1' } } } as const

  it('refuses to patch a field whose stored value carries a credential, so undo can never write a placeholder', async () => {
    mocks.handleRequest.mockResolvedValueOnce({
      id: 'x',
      status: 200,
      data: { id: 's1', env: { OPENAI_API_KEY: 'sk-live', DEBUG: '0' } }
    })
    await expect(applyWrite(patch)).rejects.toThrow('carries credentials')
    expect(mocks.handleRequest).toHaveBeenCalledTimes(1)
  })

  it('snapshots the real prior value and refuses to undo once the user changed the field again', async () => {
    mocks.handleRequest
      .mockResolvedValueOnce({ id: 'x', status: 200, data: { id: 's1', env: { DEBUG: '0' } } })
      .mockResolvedValueOnce({ id: 'x', status: 200 })
    const applied = await applyWrite(patch)
    expect(applied.before).toEqual({ env: { DEBUG: '0' } })

    mocks.handleRequest.mockResolvedValueOnce({ id: 'x', status: 200, data: { id: 's1', env: { DEBUG: 'user-edit' } } })
    await expect(undoWrite(patch, applied.before)).rejects.toThrow('changed since')
    expect(mocks.handleRequest).toHaveBeenCalledTimes(3)
  })
})

describe('writeRisk', () => {
  it('lets only reversible, relaunch-free catalog fixes run without a click', () => {
    expect(
      writeRisk({
        kind: 'doctor_fix',
        request: { scope: 'global', runId: 'r', checkId: 'mcp-servers-connected', fixId: 'restart', target: 's' }
      })
    ).toBe('auto')
    expect(
      writeRisk({
        kind: 'doctor_fix',
        request: { scope: 'global', runId: 'r', checkId: 'config-boot-config-valid', fixId: 'repair' }
      })
    ).toBe('confirm')
    expect(writeRisk({ kind: 'preference_set', key: 'app.proxy.mode', value: 'none' })).toBe('confirm')
    expect(writeRisk({ kind: 'data_api_patch', path: '/providers/x', body: { isEnabled: true } })).toBe('confirm')
  })
})
