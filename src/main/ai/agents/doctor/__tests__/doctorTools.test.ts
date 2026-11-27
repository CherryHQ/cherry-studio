import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Client } from '@modelcontextprotocol/client'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

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
      reportForSession: vi.fn(),
      incidentForSession: () => undefined
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

import { createDoctorServer } from '@main/ai/mcp/servers/doctor'

import { openDoctorReadablePath, resolveDoctorReadablePath } from '../doctorTools'
import { applyWrite, undoWrite, writeRisk } from '../doctorWrites'

async function connect(): Promise<Client> {
  return connectMcpTestClient(() => createDoctorServer('session-1'))
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

  it('refuses conversation data routes before they reach the Data API', async () => {
    const client = await connect()
    for (const route of ['/topics/t1', '/messages', '/agent-sessions']) {
      const result = await client.callTool({ name: 'data_api', arguments: { method: 'GET', path: route } })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('GET is not allowed')
    }
    expect(mocks.handleRequest).not.toHaveBeenCalled()
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

  it('refuses credentials embedded in a nested value', async () => {
    const client = await connect()
    const result = await client.callTool({
      name: 'data_api',
      arguments: {
        method: 'PATCH',
        path: '/mcp-servers/s1',
        body: { config: { endpoint: 'https://user:secret@example.com' } },
        summary: 'set endpoint'
      }
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('credential value')
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

describe('doctor server binding', () => {
  it('refuses read and probe tools outside an active doctor analysis', async () => {
    mocks.reportBinding.mockImplementation(() => {
      throw new Error('This session is not an active doctor analysis')
    })
    const client = await connect()
    const result = await client.callTool({
      name: 'probe_endpoint',
      arguments: { url: 'https://example.com' }
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not an active doctor analysis')
    expect(mocks.diagnoseEndpoint).not.toHaveBeenCalled()
    await client.close()
  })

  it('forwards endpoint probes for an active analysis', async () => {
    mocks.diagnoseEndpoint.mockResolvedValue({ status: 'reachable', httpStatus: 200 })
    const client = await connect()
    const result = await client.callTool({
      name: 'probe_endpoint',
      arguments: { url: 'https://example.com' }
    })
    expect(result.isError).toBeFalsy()
    expect(text(result)).toContain('reachable')
    expect(mocks.diagnoseEndpoint).toHaveBeenCalledWith(
      { id: 'custom', url: 'https://example.com' },
      expect.any(AbortSignal)
    )
    await client.close()
  })
})

describe('doctor session tool', () => {
  it('refuses to read any conversation when the analysis was not opened from a failed message', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'session', arguments: { action: 'overview' } })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not opened from a failed message')
    await client.close()
  })
})

describe('doctor read_file tool', () => {
  it('tails a log with secrets redacted and lists directories', async () => {
    fs.mkdirSync(path.join(userData, 'logs'), { recursive: true })
    const lines = Array.from(
      { length: 300 },
      (_, i) => `line ${i} Authorization: Bearer tok-${i} body {"error":"bad key sk-proj-abcdefghijklmnopqrstu${i}"}`
    )
    fs.writeFileSync(path.join(userData, 'logs', 'main.log'), lines.join('\n'))
    const client = await connect()
    const tail = await client.callTool({ name: 'read_file', arguments: { path: 'logs/main.log', lines: 5 } })
    const body = JSON.parse(text(tail))
    expect(body.text.split('\n')).toHaveLength(5)
    expect(body.text).toContain('line 299')
    expect(body.text).not.toContain('tok-299')
    expect(body.text).not.toContain('sk-proj-abcdefghijklmnopqrstu299')

    const listing = await client.callTool({ name: 'read_file', arguments: { path: 'logs' } })
    if (process.platform === 'linux') {
      expect(JSON.parse(text(listing)).entries).toEqual([{ name: 'main.log', kind: 'file', size: expect.any(Number) }])
    } else {
      expect(listing.isError).toBe(true)
      expect(text(listing)).toContain('Directory listing is unavailable')
    }
    await client.close()
  })

  it.each([
    ['a path outside userData', path.join(outside, 'x.txt')],
    ['a traversal', '../escape.txt'],
    ['user content', 'Data/Files/upload.pdf'],
    ['the app database', 'Data/cherrystudio.sqlite'],
    ['an agent transcript', 'Data/Agents/.claude/projects/p/session.jsonl'],
    ['the MCP memory graph', 'Data/Mcp/memory.json'],
    ['channel credentials', 'Data/weixin_bot_1.json'],
    ['browser cookies', 'Cookies'],
    ['the persisted cache', 'cache.json'],
    ['a credential file under logs', 'logs/credentials.json']
  ])('refuses %s', async (_label, target) => {
    const file = path.isAbsolute(target) ? target : path.join(userData, target)
    if (file.startsWith(userData)) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'private')
    }
    const client = await connect()
    const result = await client.callTool({ name: 'read_file', arguments: { path: target } })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Access denied')
    expect(text(result)).not.toContain('private')
    await client.close()
  })

  it.each(['config.json', 'Data/config.json', 'Toolchain/mise/config.toml', 'Crashpad/settings.dat'])(
    'reads app state at %s',
    async (target) => {
      fs.mkdirSync(path.dirname(path.join(userData, target)), { recursive: true })
      fs.writeFileSync(path.join(userData, target), 'state')
      const client = await connect()
      const result = await client.callTool({ name: 'read_file', arguments: { path: target } })
      expect(JSON.parse(text(result)).text).toBe('state')
      await client.close()
    }
  )

  it('refuses a symlink inside userData that points outside', async () => {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope')
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(userData, 'logs', 'link.txt'))
    const client = await connect()
    const result = await client.callTool({ name: 'read_file', arguments: { path: 'logs/link.txt' } })
    expect(result.isError).toBe(true)
    expect(text(result)).not.toContain('nope')
    await client.close()
  })

  it('refuses an ancestor replaced by an outside symlink after path validation', () => {
    const directory = path.join(userData, 'logs', 'race')
    const movedDirectory = path.join(userData, 'logs', 'race-original')
    fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, 'secret.txt'), 'inside')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside secret')
    const resolved = resolveDoctorReadablePath('logs/race/secret.txt')
    fs.renameSync(directory, movedDirectory)
    fs.symlinkSync(outside, directory)
    try {
      expect(() => openDoctorReadablePath(resolved)).toThrow('Access denied')
    } finally {
      fs.rmSync(directory, { force: true })
      fs.renameSync(movedDirectory, directory)
    }
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
      .mockResolvedValueOnce({ id: 'x', status: 200, data: { id: 's1', env: { DEBUG: '1' } } })
    const applied = await applyWrite(patch)
    expect(applied.before).toEqual({ env: { DEBUG: '0' } })
    expect(applied.after).toEqual({ env: { DEBUG: '1' } })

    mocks.handleRequest.mockResolvedValueOnce({ id: 'x', status: 200, data: { id: 's1', env: { DEBUG: 'user-edit' } } })
    await expect(undoWrite(patch, applied.before, applied.after)).rejects.toThrow('changed since')
    expect(mocks.handleRequest).toHaveBeenCalledTimes(4)
  })

  it('undoes a partial object patch by comparing the actual merged result', async () => {
    mocks.handleRequest
      .mockResolvedValueOnce({ id: 'x', status: 200, data: { id: 's1', env: { DEBUG: '0', KEEP: 'yes' } } })
      .mockResolvedValueOnce({ id: 'x', status: 200 })
      .mockResolvedValueOnce({ id: 'x', status: 200, data: { id: 's1', env: { DEBUG: '1', KEEP: 'yes' } } })
    const applied = await applyWrite(patch)
    expect(applied.after).toEqual({ env: { DEBUG: '1', KEEP: 'yes' } })

    mocks.handleRequest
      .mockResolvedValueOnce({ id: 'x', status: 200, data: { id: 's1', env: { DEBUG: '1', KEEP: 'yes' } } })
      .mockResolvedValueOnce({ id: 'x', status: 200 })
    await expect(undoWrite(patch, applied.before, applied.after)).resolves.toBeUndefined()
    expect(mocks.handleRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'PATCH', body: { env: { DEBUG: '0', KEEP: 'yes' } } })
    )
  })

  it('refuses a preference write when its undo snapshot would contain credentials', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.proxy.url', 'http://user:secret@proxy:8080')
    await expect(
      applyWrite({ kind: 'preference_set', key: 'app.proxy.url', value: 'http://proxy:8080' })
    ).rejects.toThrow('current value carries credentials')
    expect(application.get('PreferenceService').get('app.proxy.url')).toBe('http://user:secret@proxy:8080')
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
