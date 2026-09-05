/**
 * Regression for mcp-servers-3: read_source's sensitive-file blocklist must cover all
 * dotenv variants and private-key/cert material, not just `.env`/`.env.local`.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agentCreate: vi.fn(),
  applicationGetPath: vi.fn(),
  mcpList: vi.fn(),
  modelGetByKey: vi.fn(),
  providerGetById: vi.fn(),
  diagnoseEndpoint: vi.fn(),
  doctorRun: vi.fn()
}))

vi.mock('@application', async () => {
  const base = (await import('@test-mocks/main/application')).mockApplicationFactory({
    NetworkService: { diagnoseEndpoint: mocks.diagnoseEndpoint },
    DoctorService: { run: mocks.doctorRun }
  } as never)
  return {
    ...base,
    application: {
      ...base.application,
      getPath: mocks.applicationGetPath
    }
  }
})

vi.mock('@main/ai/agents/createAgent', () => ({
  createAgent: mocks.agentCreate
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { list: mocks.mcpList }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.modelGetByKey }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: mocks.providerGetById }
}))

import { resolveAgentCapabilities } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import type { AssistantToolName } from '@main/ai/toolApproval/assistantToolNames'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'

import AssistantServer, { isAllowedAssistantNavigationPath, isBlockedSourceFile } from '../assistant'

const SUPPORT_ASSISTANT_TOOL_NAMES = resolveAgentCapabilities({
  configuration: { builtin_role: BUILTIN_AGENT_ROLE.SUPPORT }
}).hostTools?.tools

const temporaryDirectories: string[] = []

function writeProductManifest(content: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-assistant-manifest-'))
  temporaryDirectories.push(directory)
  const manifestPath = path.join(directory, 'product-manifest.json')
  fs.writeFileSync(manifestPath, content, 'utf-8')
  mocks.applicationGetPath.mockReturnValue(manifestPath)
  return manifestPath
}

async function connectAssistantClient(enabledToolNames?: readonly AssistantToolName[]) {
  const server = new AssistantServer(undefined, enabledToolNames)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'assistant-test-client', version: '1.0.0' }, { capabilities: {} })
  await server.mcpServer.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

function toolResultText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content
  return content[0]?.type === 'text' ? (content[0].text ?? '') : ''
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  mocks.agentCreate.mockReset()
  mocks.applicationGetPath.mockReset()
  mocks.applicationGetPath.mockReturnValue('/mock/product-manifest.json')
  mocks.mcpList.mockReset()
  mocks.modelGetByKey.mockReset()
  mocks.providerGetById.mockReset()
  mocks.mcpList.mockReturnValue({ items: [] })
  mocks.modelGetByKey.mockReturnValue({ id: 'anthropic::claude-sonnet' })
  mocks.agentCreate.mockReturnValue({
    id: 'agent-created',
    name: 'Reviewer',
    model: 'anthropic::claude-sonnet'
  })
})

describe('product_info', () => {
  it('removes release lookup from the diagnose contract', async () => {
    const client = await connectAssistantClient()

    const listed = await client.listTools()
    const diagnose = listed.tools.find((tool) => tool.name === 'diagnose')
    const properties = diagnose?.inputSchema.properties as Record<string, { enum?: string[] }>

    expect(properties.action.enum).not.toContain('check_update')
    await client.close()
  })

  it('returns a compact current-package manifest index through its registered path', async () => {
    const manifest = {
      schemaVersion: 1,
      package: { name: 'CherryStudio', version: '2.0.0-dev' },
      routes: { primary: [], all: [] },
      extraFutureField: { preserved: true }
    }
    const manifestPath = writeProductManifest(JSON.stringify(manifest))
    const client = await connectAssistantClient()

    const listed = await client.listTools()
    const result = await client.callTool({ name: 'product_info', arguments: { source: 'manifest' } })

    expect(listed.tools.map((tool) => tool.name)).toContain('product_info')
    expect(mocks.applicationGetPath).toHaveBeenCalledWith('feature.agents.assistant.manifest.file')
    expect(manifestPath).toContain('product-manifest.json')
    expect(JSON.parse(toolResultText(result))).toEqual({
      runtimeVersion: '1.0.0',
      manifestVersion: '2.0.0-dev',
      sections: ['package', 'routes', 'extraFutureField']
    })
    await client.close()
  })

  it('reads one requested manifest section and supports an explicit full-manifest fallback', async () => {
    const manifest = {
      schemaVersion: 1,
      package: { name: 'CherryStudio', version: '2.0.0-dev' },
      routes: { primary: [{ id: 'agents', path: '/app/agents' }], all: ['/app/agents'] }
    }
    writeProductManifest(JSON.stringify(manifest))
    const client = await connectAssistantClient()

    const routes = await client.callTool({
      name: 'product_info',
      arguments: { source: 'manifest', section: 'routes' }
    })
    const all = await client.callTool({
      name: 'product_info',
      arguments: { source: 'manifest', section: 'all' }
    })

    expect(JSON.parse(toolResultText(routes))).toEqual({
      runtimeVersion: '1.0.0',
      manifestVersion: '2.0.0-dev',
      section: 'routes',
      data: manifest.routes
    })
    expect(JSON.parse(toolResultText(all))).toEqual({
      runtimeVersion: '1.0.0',
      manifestVersion: '2.0.0-dev',
      section: 'all',
      manifest
    })
    await client.close()
  })

  it('rejects a manifest section that is not present in the installed package', async () => {
    writeProductManifest(JSON.stringify({ schemaVersion: 1, package: { version: '2.0.0-dev' } }))
    const client = await connectAssistantClient()

    const result = await client.callTool({
      name: 'product_info',
      arguments: { source: 'manifest', section: 'removed-feature' }
    })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('Unknown product manifest section')
    await client.close()
  })

  it('rejects a package manifest containing invalid JSON', async () => {
    writeProductManifest('{not-json')
    const client = await connectAssistantClient()

    const result = await client.callTool({ name: 'product_info', arguments: { source: 'manifest' } })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('Product manifest contains invalid JSON')
    await client.close()
  })

  it('does not expose the installed manifest path when the package asset is unavailable', async () => {
    mocks.applicationGetPath.mockReturnValue('/private/install/resources/product-manifest.json')
    const client = await connectAssistantClient()

    const result = await client.callTool({ name: 'product_info', arguments: { source: 'manifest' } })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('Product manifest is unavailable')
    expect(toolResultText(result)).not.toContain('/private/install')
    await client.close()
  })

  it('rejects manifests that do not satisfy the supported schema', async () => {
    const client = await connectAssistantClient()

    for (const manifest of [null, { schemaVersion: 2, package: { version: '2.0.0' } }, { schemaVersion: 1 }]) {
      writeProductManifest(JSON.stringify(manifest))
      const result = await client.callTool({ name: 'product_info', arguments: { source: 'manifest' } })
      expect(result.isError).toBe(true)
      expect(toolResultText(result)).toContain('Product manifest schema is invalid')
    }

    writeProductManifest(JSON.stringify({ schemaVersion: 1, package: { version: '  ' } }))
    const emptyVersionResult = await client.callTool({ name: 'product_info', arguments: { source: 'manifest' } })
    expect(emptyVersionResult.isError).toBe(true)
    expect(toolResultText(emptyVersionResult)).toContain('Product manifest schema is invalid')
    await client.close()
  })

  it('rejects arbitrary path and URL arguments', async () => {
    writeProductManifest(JSON.stringify({ schemaVersion: 1, package: { version: '2.0.0-dev' } }))
    const client = await connectAssistantClient()

    for (const extra of [{ path: '/tmp/secret' }, { url: 'https://example.com' }]) {
      const result = await client.callTool({
        name: 'product_info',
        arguments: { source: 'manifest', ...extra }
      })
      expect(result.isError).toBe(true)
      expect(toolResultText(result)).toContain('Unsupported product_info argument')
    }

    await client.close()
  })

  it('rejects sources other than the installed manifest', async () => {
    writeProductManifest(JSON.stringify({ schemaVersion: 1, package: { version: '2.0.0-dev' } }))
    const client = await connectAssistantClient()

    const result = await client.callTool({
      name: 'product_info',
      arguments: { source: 'release_notes' }
    })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('Unknown product_info source')
    await client.close()
  })
})

describe('navigate', () => {
  it('uses current package routes instead of a duplicated route table', async () => {
    writeProductManifest(
      JSON.stringify({
        schemaVersion: 1,
        package: { version: '2.0.0-dev' },
        routes: {
          all: ['/settings', '/settings/provider', '/settings/mcp/$', '/app/code', '/app/mini-app/$appId']
        }
      })
    )
    const client = await connectAssistantClient()

    const currentRoute = await client.callTool({ name: 'navigate', arguments: { path: '/app/code' } })
    const dynamicRoute = await client.callTool({ name: 'navigate', arguments: { path: '/app/mini-app/example' } })
    const removedRoute = await client.callTool({ name: 'navigate', arguments: { path: '/app/openclaw' } })
    const unknownSettingsRoute = await client.callTool({
      name: 'navigate',
      arguments: { path: '/settings/not-in-this-package' }
    })

    expect(currentRoute.isError).not.toBe(true)
    expect(toolResultText(currentRoute)).toContain('/app/code')
    expect(dynamicRoute.isError).not.toBe(true)
    expect(removedRoute.isError).toBe(true)
    expect(unknownSettingsRoute.isError).toBe(true)
    await client.close()
  })
})

describe('apply_setting', () => {
  async function applySetting(args: Record<string, string>) {
    const server = new AssistantServer()
    return await (
      server as unknown as {
        applySetting: (input: Record<string, string>) => Promise<{ content: Array<{ text: string }> }>
      }
    ).applySetting(args)
  }

  it('updates the v2 theme preference', async () => {
    await applySetting({ setting: 'theme', value: 'dark' })

    expect(MockMainPreferenceServiceUtils.getPreferenceValue('ui.theme_mode')).toBe('dark')
  })

  it('rejects settings outside the narrow whitelist', async () => {
    await expect(applySetting({ setting: 'launch_on_boot', value: 'true' })).rejects.toThrow(
      "Setting 'launch_on_boot' is not on the apply_setting whitelist"
    )
  })
})

describe('create_agent', () => {
  it('is listed and callable for the default Assistant capability set', async () => {
    const client = await connectAssistantClient()

    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('create_agent')
    const result = await client.callTool({
      name: 'create_agent',
      arguments: { name: 'Reviewer', instructions: 'Review code.', model: 'anthropic::claude-sonnet' }
    })

    expect(result.isError).not.toBe(true)
    expect(mocks.agentCreate).toHaveBeenCalledOnce()
    await client.close()
  })

  it('is neither listed nor callable for the Support capability set', async () => {
    const client = await connectAssistantClient(SUPPORT_ASSISTANT_TOOL_NAMES)

    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('create_agent')
    const result = await client.callTool({
      name: 'create_agent',
      arguments: { name: 'Reviewer', instructions: 'Review code.' }
    })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('Unknown tool: create_agent')
    expect(mocks.agentCreate).not.toHaveBeenCalled()
    await client.close()
  })

  it('creates an agent through the v2 data service', async () => {
    const server = new AssistantServer()
    const result = await (
      server as unknown as {
        createAgent: (args: Record<string, string>) => Promise<{
          content: Array<{ text: string }>
          structuredContent: unknown
        }>
      }
    ).createAgent({
      name: ' Reviewer ',
      description: ' Reviews code ',
      instructions: ' Review Python code. ',
      model: 'anthropic::claude-sonnet'
    })

    expect(mocks.agentCreate).toHaveBeenCalledWith({
      type: 'claude-code',
      name: 'Reviewer',
      description: 'Reviews code',
      instructions: 'Review Python code.',
      model: 'anthropic::claude-sonnet',
      configuration: {
        permission_mode: 'default',
        env_vars: {}
      }
    })
    expect(mocks.modelGetByKey).toHaveBeenCalledWith('anthropic', 'claude-sonnet')
    const output = {
      ok: true,
      agentId: 'agent-created',
      name: 'Reviewer',
      model: 'anthropic::claude-sonnet'
    }
    expect(result.structuredContent).toEqual(output)
    expect(JSON.parse(result.content[0].text)).toEqual(output)
  })

  it("defaults to Cherry Assistant's current model when model is omitted", async () => {
    const server = new AssistantServer('openai::gpt-5')

    await (
      server as unknown as {
        createAgent: (args: Record<string, string>) => Promise<unknown>
      }
    ).createAgent({
      name: 'Reviewer',
      instructions: 'Review code.'
    })

    expect(mocks.agentCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai::gpt-5' }))
  })

  it('rejects legacy single-colon model ids', async () => {
    const server = new AssistantServer()

    await expect(
      (
        server as unknown as {
          createAgent: (args: Record<string, string>) => Promise<unknown>
        }
      ).createAgent({
        name: 'Reviewer',
        instructions: 'Review code.',
        model: 'anthropic:claude-sonnet'
      })
    ).rejects.toThrow('providerId::modelId')
    expect(mocks.agentCreate).not.toHaveBeenCalled()
  })

  it('rejects a well-formed model id that is not configured', async () => {
    mocks.modelGetByKey.mockImplementationOnce(() => {
      throw DataApiErrorFactory.notFound('Model', 'anthropic/missing')
    })
    const server = new AssistantServer()

    await expect(
      (
        server as unknown as {
          createAgent: (args: Record<string, string>) => Promise<unknown>
        }
      ).createAgent({
        name: 'Reviewer',
        instructions: 'Review code.',
        model: 'anthropic::missing'
      })
    ).rejects.toThrow('Model is not configured in Cherry Studio: anthropic::missing')
    expect(mocks.agentCreate).not.toHaveBeenCalled()
  })
})

describe('prepare_diagnostic_report', () => {
  it('is exposed only by the explicit Cherry Support capability set', async () => {
    const assistantClient = await connectAssistantClient()
    const supportClient = await connectAssistantClient(SUPPORT_ASSISTANT_TOOL_NAMES)

    expect((await assistantClient.listTools()).tools.map((tool) => tool.name)).toEqual([
      'navigate',
      'diagnose',
      'product_info',
      'apply_setting',
      'create_agent'
    ])

    const supportTools = (await supportClient.listTools()).tools
    const draftTool = supportTools.find((tool) => tool.name === 'prepare_diagnostic_report')
    expect(draftTool).toMatchObject({
      inputSchema: {
        required: ['description'],
        additionalProperties: false
      },
      outputSchema: {
        required: ['ok', 'description'],
        additionalProperties: false
      }
    })

    await assistantClient.close()
    await supportClient.close()
  })

  it('returns an editable normalized draft without performing submission', async () => {
    const client = await connectAssistantClient(SUPPORT_ASSISTANT_TOOL_NAMES)
    const output = { ok: true, description: 'first\r\nsecond\r\nthird' }

    const result = await client.callTool({
      name: 'prepare_diagnostic_report',
      arguments: { description: '  first\nsecond\rthird  ' }
    })

    expect(result.structuredContent).toEqual(output)
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(output) }])
    expect(result.isError).not.toBe(true)
    await client.close()
  })

  it('accepts a description at the normalized UTF-8 byte limit', async () => {
    const client = await connectAssistantClient(SUPPORT_ASSISTANT_TOOL_NAMES)
    const description = 'a'.repeat(4096)

    const result = await client.callTool({ name: 'prepare_diagnostic_report', arguments: { description } })

    expect(result.structuredContent).toEqual({ ok: true, description })
    await client.close()
  })

  it.each([
    ['blank description', { description: '  \r\n  ' }],
    ['description above the normalized UTF-8 byte limit', { description: `${'a'.repeat(4094)}\na` }],
    ['non-string description', { description: 42 }],
    ['unexpected input property', { description: 'details', submit: true }]
  ])('rejects %s', async (_case, args) => {
    const client = await connectAssistantClient(SUPPORT_ASSISTANT_TOOL_NAMES)

    const result = await client.callTool({ name: 'prepare_diagnostic_report', arguments: args })

    expect(result.isError).toBe(true)
    await client.close()
  })
})

describe('isBlockedSourceFile', () => {
  it('blocks every dotenv variant (except the .env.example template)', () => {
    for (const name of ['.env', '.env.local', '.env.production', '.env.development.local', '.ENV', '.Env.Staging']) {
      expect(isBlockedSourceFile(name)).toBe(true)
    }
    expect(isBlockedSourceFile('.env.example')).toBe(false)
  })

  it('blocks credentials and SSH private keys', () => {
    for (const name of ['credentials.json', 'id_rsa', 'id_dsa', 'id_ed25519', 'id_ecdsa']) {
      expect(isBlockedSourceFile(name)).toBe(true)
    }
  })

  it('blocks private-key / cert material by extension (case-insensitive)', () => {
    for (const name of ['server.key', 'cert.pem', 'bundle.p12', 'store.PFX']) {
      expect(isBlockedSourceFile(name)).toBe(true)
    }
  })

  it('allows ordinary source files', () => {
    for (const name of ['index.ts', 'README.md', 'package.json', 'env.ts']) {
      expect(isBlockedSourceFile(name)).toBe(false)
    }
  })
})

describe('isAllowedAssistantNavigationPath', () => {
  const allowedRoutes = [
    '/settings',
    '/settings/provider',
    '/settings/mcp/$',
    '/settings/mcp/settings/$serverId',
    '/app/agents',
    '/app/mini-app/$appId',
    '/app/chat'
  ]

  it('allows exact routes and manifest-declared dynamic routes', () => {
    expect(isAllowedAssistantNavigationPath('/app/agents', allowedRoutes)).toBe(true)
    expect(isAllowedAssistantNavigationPath('/app/mini-app/example', allowedRoutes)).toBe(true)
    expect(isAllowedAssistantNavigationPath('/app/chat', allowedRoutes)).toBe(true)
    expect(isAllowedAssistantNavigationPath('/settings/provider', allowedRoutes)).toBe(true)
    expect(isAllowedAssistantNavigationPath('/settings/mcp/example/details', allowedRoutes)).toBe(true)
    expect(isAllowedAssistantNavigationPath('/settings/mcp/settings/server-1', allowedRoutes)).toBe(true)
  })

  it('blocks undeclared descendants, removed routes, and prefix lookalikes', () => {
    expect(isAllowedAssistantNavigationPath('/', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/store', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app/agents/assistant-1', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app/mini-app/example/details', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app/library', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/app/openclaw', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/settings/not-in-this-package', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/openclaw', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/agents', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/agents-legacy', allowedRoutes)).toBe(false)
    expect(isAllowedAssistantNavigationPath('/settings/provider?tab=models', allowedRoutes)).toBe(false)
  })
})

describe('diagnose mcp_status', () => {
  it('redacts authenticated MCP URLs to origin only', () => {
    mocks.mcpList.mockReturnValue({
      items: [
        {
          id: 'private-mcp',
          name: 'Private MCP',
          type: 'streamableHttp',
          isActive: true,
          command: undefined,
          baseUrl: 'https://user:password@mcp.example:8443/api?token=secret#fragment'
        }
      ]
    })

    const server = new AssistantServer()
    const result = (
      server as unknown as { diagnoseMcpStatus: () => { content: Array<{ text: string }> } }
    ).diagnoseMcpStatus()
    const text = result.content[0].text
    const status = JSON.parse(text) as { servers: Array<{ baseUrl?: string }> }

    expect(status.servers[0]?.baseUrl).toBe('https://mcp.example:8443')
    expect(text).not.toContain('user')
    expect(text).not.toContain('password')
    expect(text).not.toContain('/api')
    expect(text).not.toContain('token=secret')
  })
})

describe('diagnose config', () => {
  it('reports the quick model used by topic naming', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.model_id', 'openai::gpt-4o-mini')

    const server = new AssistantServer()
    const result = await (
      server as unknown as {
        diagnoseConfig: () => Promise<{ content: Array<{ text: string }> }>
      }
    ).diagnoseConfig()
    const config = JSON.parse(result.content[0].text) as Record<string, unknown>

    expect(config.quickModel).toEqual({
      id: 'openai::gpt-4o-mini',
      provider: 'openai',
      modelId: 'gpt-4o-mini'
    })
    expect(config).not.toHaveProperty('topicNamingModel')
  })

  it('redacts assistant-visible proxy values to origin only', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(
      'app.proxy.url',
      'http://user:pass@proxy.example:8080/path?token=secret'
    )

    const server = new AssistantServer()
    const result = await (
      server as unknown as {
        diagnoseConfig: () => Promise<{ content: Array<{ text: string }> }>
      }
    ).diagnoseConfig()
    const text = result.content[0].text
    const config = JSON.parse(text) as { proxy?: string }

    expect(config.proxy).toBe('http://proxy.example:8080')
    expect(text).not.toContain('user')
    expect(text).not.toContain('pass')
    expect(text).not.toContain('token=secret')
    expect(text).not.toContain('/path')
  })
})

describe('diagnose health', () => {
  const endpoint = 'https://endpoint-user:endpoint-pass@api.example:8443/v1/chat?endpoint-token=secret#fragment'
  const ok = { status: 'ok', durationMs: 12 }

  function mockProvider() {
    mocks.providerGetById.mockReturnValue({
      apiKeys: [{ id: 'key-1' }],
      defaultChatEndpoint: 'chat',
      endpointConfigs: { chat: { baseUrl: endpoint } }
    })
  }

  async function diagnoseHealth(providerId: string) {
    const server = new AssistantServer()
    return await (
      server as unknown as {
        diagnoseHealth: (id: string) => Promise<{ content: Array<{ text: string }> }>
      }
    ).diagnoseHealth(providerId)
  }

  it('reports the layered verdict with only the endpoint origin', async () => {
    mockProvider()
    mocks.diagnoseEndpoint.mockResolvedValue({
      endpointId: 'provider:health-success',
      host: 'api.example',
      dns: ok,
      tls: ok,
      proxy: { effective: 'PROXY corp-proxy.internal:3128', configuredMode: 'system' },
      http: { ...ok, data: { status: 401 } },
      verdict: 'reachable'
    })

    const result = await diagnoseHealth('health-success')
    const text = result.content[0].text
    const health = JSON.parse(text) as {
      status: string
      host: string
      http: { httpStatus: number }
      proxy: { mode: string }
    }

    expect(health).toMatchObject({
      status: 'reachable',
      host: 'https://api.example:8443',
      http: { httpStatus: 401 },
      proxy: { mode: 'system' }
    })
    expect(mocks.diagnoseEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider:health-success', url: endpoint }),
      expect.any(AbortSignal)
    )
    for (const secret of [
      'endpoint-user',
      'endpoint-pass',
      '/v1/chat',
      'endpoint-token=secret',
      'corp-proxy.internal'
    ]) {
      expect(text).not.toContain(secret)
    }
  })

  it('surfaces the failing layer and its code without leaking the URL', async () => {
    mockProvider()
    mocks.diagnoseEndpoint.mockResolvedValue({
      endpointId: 'provider:health-connection-failure',
      host: 'api.example',
      dns: { status: 'failed', durationMs: 5, kind: 'dns', code: 'ENOTFOUND' },
      tls: { status: 'skipped', durationMs: 0, skippedBecause: 'dns_failed' },
      proxy: { effective: 'DIRECT', configuredMode: 'none' },
      http: { status: 'skipped', durationMs: 0, skippedBecause: 'dns_failed' },
      verdict: 'unreachable'
    })

    const health = JSON.parse((await diagnoseHealth('health-connection-failure')).content[0].text) as {
      status: string
      dns: { kind: string; code: string }
    }
    expect(health).toMatchObject({ status: 'unreachable', dns: { kind: 'dns', code: 'ENOTFOUND' } })
  })

  it('does not probe a provider without an API key', async () => {
    mocks.providerGetById.mockReturnValue({ apiKeys: [], endpointConfigs: { chat: { baseUrl: endpoint } } })
    const health = JSON.parse((await diagnoseHealth('health-no-key')).content[0].text) as { error: string }
    expect(health.error).toBe('No API key configured')
    expect(mocks.diagnoseEndpoint).not.toHaveBeenCalled()
  })
})

describe('diagnose doctor', () => {
  it('returns the upload projection of the report, dropping local-only data', async () => {
    mocks.doctorRun.mockResolvedValue({
      status: 'completed',
      report: {
        schemaVersion: 1,
        runId: 'r1',
        tier: 'quick',
        startedAt: 's',
        finishedAt: 'f',
        expiresAt: 'e',
        basics: { version: '2.0.0', userDataPath: '/Users/alice/secret' },
        results: [
          {
            id: 'storage-userdata-location',
            status: 'warn',
            durationMs: 1,
            attribution: 'user-fixable',
            detail: { variant: 'fallback_to_default' },
            actions: [],
            evidence: [
              { key: 'actual', value: '/Users/alice/secret', dataClass: 'local_only' },
              { key: 'configuredUsableNow', value: false, dataClass: 'public' }
            ]
          }
        ],
        summary: { pass: 0, warn: 1, fail: 0, skip: 0, error: 0 }
      }
    })
    const server = new AssistantServer()
    const text = (
      await (
        server as unknown as { diagnoseDoctor: (tier: string) => Promise<{ content: Array<{ text: string }> }> }
      ).diagnoseDoctor('quick')
    ).content[0].text

    expect(mocks.doctorRun).toHaveBeenCalledWith({ tier: 'quick' })
    expect(JSON.parse(text)).toMatchObject({ summary: { warn: 1 } })
    expect(text).not.toContain('/Users/alice/secret')
    expect(text).toContain('configuredUsableNow')
  })

  it('passes a busy outcome through so the model can retry later', async () => {
    mocks.doctorRun.mockResolvedValue({ status: 'busy', runId: 'r9' })
    const server = new AssistantServer()
    const text = (
      await (
        server as unknown as { diagnoseDoctor: (tier: string) => Promise<{ content: Array<{ text: string }> }> }
      ).diagnoseDoctor('live')
    ).content[0].text
    expect(JSON.parse(text)).toEqual({ status: 'busy', runId: 'r9' })
  })
})
