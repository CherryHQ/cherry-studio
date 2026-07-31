import fs from 'fs'
import os from 'os'
import path from 'path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LoggerService } from '@logger'
import type { McpClientSdk, McpTransport } from '@main/ai/mcp/mcpClientSdk'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpServerLogEntry } from '@shared/types/mcp'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({} as Record<string, unknown>)
})
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
vi.mock('@main/ai/mcp/servers/factory', () => ({
  createInMemoryMcpServer: vi.fn(),
  getBuiltinHttpHeaders: () => ({}),
  getBuiltinRegistryEnv: () => ({}),
  hasInMemoryImplementation: () => false
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: async () => ({ PATH: process.env.PATH ?? '' })
}))

const { createTransport } = await import('../mcpTransport')

const sdk = { Client, StdioClientTransport } as unknown as McpClientSdk
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LoggerService
const authProvider = { config: {} } as any

describe.skipIf(process.platform !== 'win32')('Windows MCP stdio absolute commands', () => {
  let fixtureDir: string
  let commandPath: string
  let client: Client | undefined
  let transport: McpTransport | undefined

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-mcp-stdio path-'))
    const serverPath = path.join(fixtureDir, 'server.mjs')
    commandPath = path.join(fixtureDir, 'server.cmd')

    fs.writeFileSync(
      serverPath,
      [
        "import readline from 'node:readline'",
        'const lines = readline.createInterface({ input: process.stdin })',
        'for await (const line of lines) {',
        '  const request = JSON.parse(line)',
        "  if (!Object.hasOwn(request, 'id')) continue",
        "  const result = request.method === 'initialize'",
        '    ? {',
        '        protocolVersion: request.params.protocolVersion,',
        '        capabilities: { tools: {} },',
        "        serverInfo: { name: 'absolute-command-fixture', version: '1.0.0' }",
        '      }',
        "    : request.method === 'tools/list' ? { tools: [] } : {}",
        "  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\\n`)",
        '}'
      ].join('\n'),
      'utf8'
    )
    fs.writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0server.mjs"\r\n`, 'utf8')
  })

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    if (!client) await transport?.close().catch(() => undefined)
    fs.rmSync(fixtureDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it.each([
    ['an exact path', (value: string) => value],
    ['surrounding whitespace', (value: string) => `  ${value}  `]
  ])('connects, initializes, and lists tools through %s', async (_case, configureCommand) => {
    const serverLogs: McpServerLogEntry[] = []
    transport = await createTransport({
      sdk,
      server: {
        id: 'absolute-command-test',
        name: 'absolute-command-test',
        type: 'stdio',
        command: configureCommand(commandPath),
        isActive: true
      } as McpServer,
      args: [],
      authProvider,
      logger,
      onServerLog: (entry) => serverLogs.push(entry)
    })

    client = new Client({ name: 'cherry-test-client', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)

    await expect(client.listTools()).resolves.toEqual({ tools: [] })
    expect(serverLogs).toEqual([])
  })

  it('surfaces the underlying spawn error for a missing absolute command', async () => {
    const missingCommand = path.join(fixtureDir, 'missing.cmd')
    const serverLogs: McpServerLogEntry[] = []
    transport = await createTransport({
      sdk,
      server: {
        id: 'missing-command-test',
        name: 'missing-command-test',
        type: 'stdio',
        command: missingCommand,
        isActive: true
      } as McpServer,
      args: [],
      authProvider,
      logger,
      onServerLog: (entry) => serverLogs.push(entry)
    })

    client = new Client({ name: 'cherry-test-client', version: '1.0.0' }, { capabilities: {} })
    await expect(client.connect(transport)).rejects.toThrow(/Connection closed/)

    const spawnLog = serverLogs.find((entry) => entry.level === 'error')
    expect(spawnLog).toMatchObject({
      data: { code: 'ENOENT', path: missingCommand },
      source: 'stdio'
    })
    expect(spawnLog?.message).toContain('code=ENOENT')
    expect(spawnLog?.message).toContain(`path=${missingCommand}`)
  })
})
