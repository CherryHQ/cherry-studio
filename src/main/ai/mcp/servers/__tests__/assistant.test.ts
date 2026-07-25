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
  providerGetById: vi.fn()
}))

vi.mock('@application', async () => {
  const base = (await import('@test-mocks/main/application')).mockApplicationFactory()
  return {
    ...base,
    application: {
      ...base.application,
      getPath: mocks.applicationGetPath
    }
  }
})

vi.mock('@data/services/AgentService', () => ({
  agentService: { createAgent: mocks.agentCreate }
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

import AssistantServer, { isAllowedAssistantNavigationPath, isBlockedSourceFile } from '../assistant'

const temporaryDirectories: string[] = []

function writeProductManifest(content: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-assistant-manifest-'))
  temporaryDirectories.push(directory)
  const manifestPath = path.join(directory, 'product-manifest.json')
  fs.writeFileSync(manifestPath, content, 'utf-8')
  mocks.applicationGetPath.mockReturnValue(manifestPath)
  return manifestPath
}

async function connectAssistantClient() {
  const server = new AssistantServer()
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
  it('creates an agent through the v2 data service', async () => {
    const server = new AssistantServer()
    const result = await (
      server as unknown as {
        createAgent: (args: Record<string, string>) => Promise<{ content: Array<{ text: string }> }>
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
        max_turns: 100,
        env_vars: {}
      }
    })
    expect(mocks.modelGetByKey).toHaveBeenCalledWith('anthropic', 'claude-sonnet')
    expect(result.content[0].text).toContain('agent-created')
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

  it('returns only the endpoint origin after a successful health check', async () => {
    mockProvider()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200 }))
    )
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    const result = await diagnoseHealth('health-success')
    const text = result.content[0].text
    const health = JSON.parse(text) as { host: string }

    expect(health.host).toBe('https://api.example:8443')
    expect(clearTimeoutSpy).toHaveBeenCalled()
    for (const secret of ['endpoint-user', 'endpoint-pass', '/v1/chat', 'endpoint-token=secret']) {
      expect(text).not.toContain(secret)
    }
  })

  it('uses a structural connection failure without leaking endpoint or fetch-error URLs', async () => {
    mockProvider()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect https://error-user:error-pass@error.example:9443/private?error-token=secret')
      })
    )
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    const result = await diagnoseHealth('health-connection-failure')
    const text = result.content[0].text
    const health = JSON.parse(text) as { host: string; error: string }

    expect(health).toMatchObject({ host: 'https://api.example:8443', error: 'connection failure' })
    expect(clearTimeoutSpy).toHaveBeenCalled()
    for (const secret of [
      'endpoint-user',
      'endpoint-pass',
      '/v1/chat',
      'endpoint-token=secret',
      'error-user',
      'error-pass',
      'error.example',
      '/private',
      'error-token=secret'
    ]) {
      expect(text).not.toContain(secret)
    }
  })

  it('reports timeouts structurally and clears the timeout', async () => {
    mockProvider()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('https://error-user:error-pass@error.example/private?error-token=secret'), {
          name: 'AbortError'
        })
      })
    )
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    const result = await diagnoseHealth('health-timeout')
    const text = result.content[0].text
    const health = JSON.parse(text) as { error: string }

    expect(health.error).toBe('timeout')
    expect(clearTimeoutSpy).toHaveBeenCalled()
    expect(text).not.toContain('error-token=secret')
  })
})
