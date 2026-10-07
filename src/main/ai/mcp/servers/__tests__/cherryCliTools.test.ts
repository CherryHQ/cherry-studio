import type { Client } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectAgentMcpClient, serveAgentMcpServer } from '@main/ai/runtime/agentMcpServer'

const binaryManager = {
  getToolInventory: vi.fn(),
  searchRegistry: vi.fn(),
  installByName: vi.fn(),
  addCustomTool: vi.fn()
}
const codeCliService = { installCli: vi.fn() }

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'BinaryManager') return binaryManager
      if (name === 'CodeCliService') return codeCliService
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

const { registerCliTools, CLI_INSTALL_TOOL_NAME, CLI_LIST_TOOL_NAME, CLI_SEARCH_TOOL_NAME } =
  await import('../cherryCliTools')

type Result = { isError?: boolean; content: Array<{ type: string; text?: string }> }
const clients: Client[] = []

async function connectCli(): Promise<Client> {
  const client = await connectAgentMcpClient(
    {
      name: 'cherry-tools',
      connect: serveAgentMcpServer(() => {
        const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
        registerCliTools(server)
        return server
      })
    },
    'test'
  )
  clients.push(client)
  return client
}

async function call(name: string, args: Record<string, unknown>): Promise<Result> {
  return (await connectCli()).callTool({ name, arguments: args })
}

function textOf(result: Result): string {
  return result.content[0].type === 'text' ? (result.content[0].text ?? '') : ''
}

function json(result: Result) {
  return JSON.parse(textOf(result) || '{}')
}

describe('cherry-tools CLI tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    binaryManager.getToolInventory.mockResolvedValue([])
    binaryManager.searchRegistry.mockResolvedValue([])
    binaryManager.installByName.mockResolvedValue(undefined)
    binaryManager.addCustomTool.mockResolvedValue(undefined)
    codeCliService.installCli.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
  })

  it('advertises the thin list/search/install surface', async () => {
    const { tools } = await (await connectCli()).listTools()
    expect(tools.map((tool) => tool.name)).toEqual([CLI_LIST_TOOL_NAME, CLI_SEARCH_TOOL_NAME, CLI_INSTALL_TOOL_NAME])
    expect(tools.find((tool) => tool.name === CLI_LIST_TOOL_NAME)?.description).toContain('command -v <name>')
    expect(tools.find((tool) => tool.name === CLI_SEARCH_TOOL_NAME)?.inputSchema.required).toEqual(['query'])
    expect(tools.find((tool) => tool.name === CLI_INSTALL_TOOL_NAME)?.inputSchema.required).toEqual(['name', 'tool'])
  })

  it('returns the live BinaryManager inventory on every call', async () => {
    binaryManager.getToolInventory.mockResolvedValue([{ name: 'bun', status: 'ready', version: '1.3.14' }])
    const cli = await connectCli()

    expect(json((await cli.callTool({ name: CLI_LIST_TOOL_NAME, arguments: {} })) as Result)).toEqual({
      tools: [{ name: 'bun', status: 'ready', version: '1.3.14' }]
    })
    binaryManager.getToolInventory.mockResolvedValue([{ name: 'bun', status: 'ready', version: '1.4.0' }])
    expect(json((await cli.callTool({ name: CLI_LIST_TOOL_NAME, arguments: {} })) as Result)).toEqual({
      tools: [{ name: 'bun', status: 'ready', version: '1.4.0' }]
    })
  })

  it('cancels the live inventory read when the caller aborts the call', async () => {
    let received: AbortSignal | undefined
    binaryManager.getToolInventory.mockImplementation((signal: AbortSignal) => {
      received = signal
      return new Promise(() => {})
    })
    const controller = new AbortController()
    const pending = (await connectCli()).callTool(
      { name: CLI_LIST_TOOL_NAME, arguments: {} },
      { signal: controller.signal }
    )
    await vi.waitFor(() => expect(received).toBeDefined())

    controller.abort()

    await expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(received?.aborted).toBe(true))
  })

  it('forwards a registry query without translating installation commands', async () => {
    binaryManager.searchRegistry.mockResolvedValue([{ name: 'fd', tool: 'aqua:sharkdp/fd' }])

    expect(json(await call(CLI_SEARCH_TOOL_NAME, { query: 'fd' }))).toEqual([{ name: 'fd', tool: 'aqua:sharkdp/fd' }])
    expect(binaryManager.searchRegistry).toHaveBeenCalledWith('fd')
  })

  it('installs an existing definition by name and forwards a one-shot version', async () => {
    binaryManager.getToolInventory
      .mockResolvedValueOnce([{ name: 'fd', recipe: 'aqua:sharkdp/fd', status: 'not_installed' }])
      .mockResolvedValueOnce([{ name: 'fd', recipe: 'aqua:sharkdp/fd', status: 'ready', version: '10.2.0' }])

    const result = await call(CLI_INSTALL_TOOL_NAME, {
      name: 'fd',
      tool: 'aqua:sharkdp/fd',
      requestedVersion: '10.2.0'
    })

    expect(result.isError).toBeFalsy()
    expect(binaryManager.installByName).toHaveBeenCalledWith({ name: 'fd', targetVersion: '10.2.0' })
    expect(binaryManager.addCustomTool).not.toHaveBeenCalled()
    expect(json(result)).toEqual({
      tool: { name: 'fd', recipe: 'aqua:sharkdp/fd', status: 'ready', version: '10.2.0' }
    })
  })

  it('routes a canonical Code CLI install through CodeCliService', async () => {
    binaryManager.getToolInventory
      .mockResolvedValueOnce([{ name: 'codex', recipe: 'codex', status: 'not_installed' }])
      .mockResolvedValueOnce([{ name: 'codex', recipe: 'codex', status: 'ready', version: '1.2.3' }])

    const result = await call(CLI_INSTALL_TOOL_NAME, {
      name: 'codex',
      tool: 'codex',
      requestedVersion: '1.2.3'
    })

    expect(codeCliService.installCli).toHaveBeenCalledWith({ name: 'codex', targetVersion: '1.2.3' })
    expect(binaryManager.installByName).not.toHaveBeenCalled()
    expect(result.isError).toBeFalsy()
  })

  it('persists an arbitrary valid mise backend through BinaryManager', async () => {
    binaryManager.getToolInventory
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: 'acme', recipe: 'ubi:acme/cli', status: 'ready' }])

    await call(CLI_INSTALL_TOOL_NAME, {
      name: 'acme',
      tool: 'ubi:acme/cli'
    })

    expect(binaryManager.addCustomTool).toHaveBeenCalledWith({
      name: 'acme',
      tool: 'ubi:acme/cli'
    })
  })

  it('returns a tool error when the final inventory status is not ready', async () => {
    binaryManager.getToolInventory
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: 'acme', recipe: 'ubi:acme/cli', status: 'failed' }])

    const result = await call(CLI_INSTALL_TOOL_NAME, {
      name: 'acme',
      tool: 'ubi:acme/cli'
    })

    expect(result.isError).toBe(true)
    expect(json(result)).toEqual({
      tool: { name: 'acme', recipe: 'ubi:acme/cli', status: 'failed' }
    })
  })

  it('lets BinaryManager validation errors reach the model', async () => {
    binaryManager.addCustomTool.mockRejectedValue(new Error('Invalid tool specification: curl installer'))

    const result = await call(CLI_INSTALL_TOOL_NAME, {
      name: 'acme',
      tool: 'curl installer'
    })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Invalid tool specification: curl installer')
  })

  it('does not let a divergent recipe bypass a canonical existing definition', async () => {
    binaryManager.getToolInventory.mockResolvedValue([{ name: 'fd', recipe: 'aqua:sharkdp/fd', status: 'ready' }])
    binaryManager.addCustomTool.mockRejectedValue(new Error('Tool fd is a built-in tool and cannot be added'))

    const result = await call(CLI_INSTALL_TOOL_NAME, {
      name: 'fd',
      tool: 'npm:fd'
    })

    expect(result.isError).toBe(true)
    expect(binaryManager.installByName).not.toHaveBeenCalled()
    expect(textOf(result)).toContain('built-in tool')
  })
})
