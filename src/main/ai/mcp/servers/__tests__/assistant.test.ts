/**
 * Regression for mcp-servers-3: read_source's sensitive-file blocklist must cover all
 * dotenv variants and private-key/cert material, not just `.env`/`.env.local`.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Client } from '@modelcontextprotocol/client'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory } from '@shared/data/api/errors'

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
import { connectAgentMcpClient, serveAgentMcpServer } from '@main/ai/runtime/agentMcpServer'
import type { AssistantToolName } from '@main/ai/toolApproval/assistantToolNames'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import type { UniqueModelId } from '@shared/data/types/model'
import { isAllowedNavigationPath } from '@shared/utils/navigationPath'

import { createAssistantServer, isBlockedSourceFile } from '../assistant'

const SUPPORT_ASSISTANT_TOOL_NAMES = resolveAgentCapabilities({
  configuration: { builtin_role: BUILTIN_AGENT_ROLE.SUPPORT }
}).hostTools?.tools

const temporaryDirectories: string[] = []
const clients: Client[] = []

function writeProductManifest(content: string): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-assistant-manifest-'))
  temporaryDirectories.push(directory)
  const manifestPath = path.join(directory, 'product-manifest.json')
  fs.writeFileSync(manifestPath, content, 'utf-8')
  mocks.applicationGetPath.mockImplementation((key: string) =>
    key === 'feature.agents.assistant.manifest.file' ? manifestPath : '/mock/unrelated-path'
  )
}

async function connectAssistantClient(
  enabledToolNames?: readonly AssistantToolName[],
  defaultModel?: UniqueModelId
): Promise<Client> {
  const client = await connectAgentMcpClient(
    { name: 'assistant', connect: serveAgentMcpServer(() => createAssistantServer(defaultModel, enabledToolNames)) },
    'test'
  )
  clients.push(client)
  return client
}

async function callTool(name: string, args: Record<string, unknown>, client?: Client) {
  return (client ?? (await connectAssistantClient())).callTool({ name, arguments: args })
}

function toolResultText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content
  return content[0]?.type === 'text' ? (content[0].text ?? '') : ''
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

beforeEach(() => {
  MockMainCacheServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  mocks.agentCreate.mockReset()
  mocks.applicationGetPath.mockReset()
  mocks.applicationGetPath.mockReturnValue('/mock/product-manifest.json')
  mocks.mcpList.mockReset()
  mocks.modelGetByKey.mockReset()
  mocks.providerGetById.mockReset()
  mocks.diagnoseEndpoint.mockReset()
  mocks.doctorRun.mockReset()
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
  })

  it('returns a compact current-package manifest index through its registered path', async () => {
    const manifest = {
      schemaVersion: 1,
      package: { name: 'CherryStudio', version: '2.0.0-dev' },
      routes: { primary: [], all: [] },
      extraFutureField: { preserved: true }
    }
    writeProductManifest(JSON.stringify(manifest))
    const client = await connectAssistantClient()

    const listed = await client.listTools()
    const result = await client.callTool({ name: 'product_info', arguments: { source: 'manifest' } })

    expect(listed.tools.map((tool) => tool.name)).toContain('product_info')
    expect(JSON.parse(toolResultText(result))).toEqual({
      runtimeVersion: '1.0.0',
      manifestVersion: '2.0.0-dev',
      sections: ['package', 'routes', 'extraFutureField']
    })
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
  })

  it('rejects a package manifest containing invalid JSON', async () => {
    writeProductManifest('{not-json')
    const client = await connectAssistantClient()

    const result = await client.callTool({ name: 'product_info', arguments: { source: 'manifest' } })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('Product manifest contains invalid JSON')
  })

  it('does not expose the installed manifest path when the package asset is unavailable', async () => {
    mocks.applicationGetPath.mockReturnValue('/private/install/resources/product-manifest.json')
    const client = await connectAssistantClient()

    const result = await client.callTool({ name: 'product_info', arguments: { source: 'manifest' } })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('Product manifest is unavailable')
    expect(toolResultText(result)).not.toContain('/private/install')
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
      expect(toolResultText(result)).toContain('Input validation error')
    }
  })

  it('rejects sources other than the installed manifest', async () => {
    writeProductManifest(JSON.stringify({ schemaVersion: 1, package: { version: '2.0.0-dev' } }))
    const client = await connectAssistantClient()

    const result = await client.callTool({
      name: 'product_info',
      arguments: { source: 'release_notes' }
    })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('Input validation error')
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
  })
})

describe('apply_setting', () => {
  it('updates the v2 theme preference', async () => {
    const result = await callTool('apply_setting', { setting: 'theme', value: 'dark' })

    expect(result.isError).not.toBe(true)
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('ui.theme_mode')).toBe('dark')
  })

  it('rejects settings outside the narrow whitelist', async () => {
    const result = await callTool('apply_setting', { setting: 'launch_on_boot', value: 'true' })

    expect(result.isError).toBe(true)
  })

  it('rejects a value outside the setting allowlist without writing it', async () => {
    const result = await callTool('apply_setting', { setting: 'theme', value: 'neon' })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain("Value 'neon' is not valid for setting 'theme'")
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('ui.theme_mode')).not.toBe('neon')
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
  })

  it('is neither listed nor callable for the Support capability set', async () => {
    const client = await connectAssistantClient(SUPPORT_ASSISTANT_TOOL_NAMES)

    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('create_agent')
    await expect(
      client.callTool({ name: 'create_agent', arguments: { name: 'Reviewer', instructions: 'Review code.' } })
    ).rejects.toThrow('create_agent')
    expect(mocks.agentCreate).not.toHaveBeenCalled()
  })

  it('creates an agent through the v2 data service', async () => {
    const result = await callTool('create_agent', {
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
    const output = {
      ok: true,
      agentId: 'agent-created',
      name: 'Reviewer',
      model: 'anthropic::claude-sonnet'
    }
    expect(result.structuredContent).toEqual(output)
    expect(JSON.parse(toolResultText(result))).toEqual(output)
  })

  it("defaults to Cherry Assistant's current model when model is omitted", async () => {
    const client = await connectAssistantClient(undefined, 'openai::gpt-5')

    await callTool('create_agent', { name: 'Reviewer', instructions: 'Review code.' }, client)

    expect(mocks.agentCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai::gpt-5' }))
  })

  it('rejects legacy single-colon model ids', async () => {
    const result = await callTool('create_agent', {
      name: 'Reviewer',
      instructions: 'Review code.',
      model: 'anthropic:claude-sonnet'
    })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('providerId::modelId')
    expect(mocks.agentCreate).not.toHaveBeenCalled()
  })

  it('rejects a well-formed model id that is not configured', async () => {
    mocks.modelGetByKey.mockImplementationOnce(() => {
      throw DataApiErrorFactory.notFound('Model', 'anthropic/missing')
    })
    const result = await callTool('create_agent', {
      name: 'Reviewer',
      instructions: 'Review code.',
      model: 'anthropic::missing'
    })

    expect(result.isError).toBe(true)
    expect(toolResultText(result)).toContain('Model is not configured in Cherry Studio: anthropic::missing')
    expect(mocks.agentCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['blank name', { name: '   ', instructions: 'Review code.', model: 'anthropic::claude-sonnet' }],
    ['missing instructions', { name: 'Reviewer', model: 'anthropic::claude-sonnet' }],
    ['no model and no default model', { name: 'Reviewer', instructions: 'Review code.' }]
  ])('rejects %s without creating an agent', async (_case, args) => {
    const result = await callTool('create_agent', args)

    expect(result.isError).toBe(true)
    expect(mocks.agentCreate).not.toHaveBeenCalled()
  })
})

describe('prepare_diagnostic_report', () => {
  it('is exposed by the default assistant tool set and callable through the packaged list path', async () => {
    const assistantClient = await connectAssistantClient()
    const supportClient = await connectAssistantClient(SUPPORT_ASSISTANT_TOOL_NAMES)

    expect((await assistantClient.listTools()).tools.map((tool) => tool.name)).toEqual([
      'navigate',
      'diagnose',
      'product_info',
      'apply_setting',
      'create_agent',
      'prepare_diagnostic_report'
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
  })

  it('returns an editable normalized draft without performing submission', async () => {
    const client = await connectAssistantClient()
    const output = { ok: true, description: 'first\r\nsecond\r\nthird' }

    const result = await client.callTool({
      name: 'prepare_diagnostic_report',
      arguments: { description: '  first\nsecond\rthird  ' }
    })

    expect(result.structuredContent).toEqual(output)
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(output) }])
    expect(result.isError).not.toBe(true)
  })

  it('accepts a description at the normalized UTF-8 byte limit', async () => {
    const client = await connectAssistantClient(SUPPORT_ASSISTANT_TOOL_NAMES)
    const description = 'a'.repeat(4096)

    const result = await client.callTool({ name: 'prepare_diagnostic_report', arguments: { description } })

    expect(result.structuredContent).toEqual({ ok: true, description })
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

describe('isAllowedNavigationPath', () => {
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
    expect(isAllowedNavigationPath('/app/agents', allowedRoutes)).toBe(true)
    expect(isAllowedNavigationPath('/app/mini-app/example', allowedRoutes)).toBe(true)
    expect(isAllowedNavigationPath('/app/chat', allowedRoutes)).toBe(true)
    expect(isAllowedNavigationPath('/settings/provider', allowedRoutes)).toBe(true)
    expect(isAllowedNavigationPath('/settings/mcp/example/details', allowedRoutes)).toBe(true)
    expect(isAllowedNavigationPath('/settings/mcp/settings/server-1', allowedRoutes)).toBe(true)
  })

  it('blocks undeclared descendants, removed routes, and prefix lookalikes', () => {
    expect(isAllowedNavigationPath('/', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/store', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/app', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/app/agents/assistant-1', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/app/mini-app/example/details', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/app/library', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/app/openclaw', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/settings/not-in-this-package', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/openclaw', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/agents', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/agents-legacy', allowedRoutes)).toBe(false)
    expect(isAllowedNavigationPath('/settings/provider?tab=models', allowedRoutes)).toBe(false)
  })
})

describe('diagnose mcp_status', () => {
  it('redacts authenticated MCP URLs to origin only', async () => {
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

    const text = toolResultText(await callTool('diagnose', { action: 'mcp_status' }))
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

    const config = JSON.parse(toolResultText(await callTool('diagnose', { action: 'config' }))) as Record<
      string,
      unknown
    >

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

    const text = toolResultText(await callTool('diagnose', { action: 'config' }))
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

  async function diagnoseHealth(providerId: string): Promise<string> {
    return toolResultText(await callTool('diagnose', { action: 'health', provider_id: providerId }))
  }

  it('requires a provider id', async () => {
    const result = await callTool('diagnose', { action: 'health' })

    expect(result.isError).toBe(true)
    expect(mocks.diagnoseEndpoint).not.toHaveBeenCalled()
  })

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

    const text = await diagnoseHealth('health-success')
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

    const health = JSON.parse(await diagnoseHealth('health-connection-failure')) as {
      status: string
      dns: { kind: string; code: string }
    }
    expect(health).toMatchObject({ status: 'unreachable', dns: { kind: 'dns', code: 'ENOTFOUND' } })
  })

  it('does not probe a provider without an API key', async () => {
    mocks.providerGetById.mockReturnValue({ apiKeys: [], endpointConfigs: { chat: { baseUrl: endpoint } } })
    const health = JSON.parse(await diagnoseHealth('health-no-key')) as { error: string }
    expect(health.error).toBe('No API key configured')
    expect(mocks.diagnoseEndpoint).not.toHaveBeenCalled()
  })

  it('probes an external-CLI provider that holds no app-side API key', async () => {
    mocks.providerGetById.mockReturnValue({
      apiKeys: [],
      authMethods: ['external-cli'],
      defaultChatEndpoint: 'chat',
      endpointConfigs: { chat: { baseUrl: endpoint } }
    })
    mocks.diagnoseEndpoint.mockResolvedValue({
      endpointId: 'provider:health-external-cli',
      host: 'api.example',
      dns: ok,
      tls: ok,
      proxy: { effective: 'DIRECT', configuredMode: 'none' },
      http: { ...ok, data: { status: 401 } },
      verdict: 'reachable'
    })

    const health = JSON.parse(await diagnoseHealth('health-external-cli')) as {
      status: string
      host: string
      error?: string
    }
    expect(health).toMatchObject({ status: 'reachable', host: 'https://api.example:8443' })
    expect(health.error).toBeUndefined()
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
            actions: [{ kind: 'open_path', path: '/Users/alice/private-action' }],
            devMessage: 'developer trace at /Users/alice/private.log',
            evidence: [
              { key: 'actual', value: '/Users/alice/secret', dataClass: 'local_only' },
              { key: 'configuredUsableNow', value: false, dataClass: 'public' }
            ]
          },
          {
            id: 'runtime-managed-tools',
            status: 'error',
            durationMs: 2,
            message: 'spawn failed at /Users/alice/private-runtime'
          }
        ],
        summary: { pass: 0, warn: 1, fail: 0, skip: 0, error: 1 }
      }
    })
    const text = toolResultText(await callTool('diagnose', { action: 'doctor' }))

    expect(mocks.doctorRun).toHaveBeenCalledWith({ tier: 'quick', subject: { kind: 'global' } })
    expect(JSON.parse(text)).toMatchObject({ summary: { warn: 1 } })
    expect(text).not.toContain('/Users/alice/secret')
    expect(text).not.toContain('/Users/alice/private-action')
    expect(text).not.toContain('/Users/alice/private.log')
    expect(text).not.toContain('/Users/alice/private-runtime')
    expect(text).toContain('configuredUsableNow')
  })

  it('passes a busy outcome through so the model can retry later', async () => {
    mocks.doctorRun.mockResolvedValue({ status: 'busy', runId: 'r9' })
    const text = toolResultText(await callTool('diagnose', { action: 'doctor', tier: 'live' }))
    expect(JSON.parse(text)).toEqual({ status: 'busy', runId: 'r9' })
  })
})
