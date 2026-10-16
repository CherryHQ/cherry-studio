import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { t } from '@main/i18n'

import { AgentSessionWorkspaceError } from '../agentSessionWorkspace'
import type { PiConnectionSnapshot } from './piConnectionSignature'
import type * as PiMcpExtension from './piMcpExtension'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  getById: vi.fn(),
  capture: vi.fn(),
  buildPrompt: vi.fn(),
  createAgentSession: vi.fn(),
  reload: vi.fn(),
  resolveInjection: vi.fn()
}))

vi.mock('@application', async () => {
  const { createMockApplication } = await import('@test-mocks/main/application')
  return {
    application: {
      ...createMockApplication({ McpCatalogService: { listTools: () => [] } } as never),
      getPath: mocks.getPath
    }
  }
})
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: { getById: mocks.getById } }))
vi.mock('./piConnectionSignature', () => ({
  capturePiConnectionSnapshot: mocks.capture,
  PiInvalidConnectionSnapshotError: class extends Error {}
}))
vi.mock('@main/ai/runtime/agentPrompt', () => ({ buildAgentRuntimePrompt: mocks.buildPrompt }))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({
  warmAgentMcpToolCatalogs: async () => undefined,
  buildAgentMcpServers: () => ({})
}))
vi.mock('./piMcpExtension', async (importOriginal) => ({
  ...(await importOriginal<typeof PiMcpExtension>()),
  createPiMcpExtension: () => () => undefined
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: async () => ({}),
  getPathFromEnvironment: () => undefined
}))
vi.mock('@main/utils/commandResolver', () => ({
  autoDiscoverGitBash: () => null,
  validateGitBashPath: () => null
}))
vi.mock('./modelInjection', () => ({
  usesPiGateway: () => false,
  resolvePiProviderInjectionForSession: mocks.resolveInjection,
  materializePiProviderStream: async () => ({ providerConfig: { models: [] }, streamSimple: vi.fn() })
}))
vi.mock('./piSdk', () => ({
  loadPiAi: async () => ({ InMemoryCredentialStore: class {} }),
  loadPiVccExtension: async () => () => undefined,
  loadPiSdk: async () => ({
    ModelRuntime: {
      create: async () => ({
        registerProvider: () => undefined,
        setRuntimeApiKey: async () => undefined,
        getModel: () => ({ id: 'model', provider: 'provider' }),
        unregisterProvider: () => undefined
      })
    },
    SettingsManager: { inMemory: () => ({}) },
    DefaultResourceLoader: class {
      reload = mocks.reload
    },
    SessionManager: { create: () => ({}) },
    createCodemodeExtension: () => () => undefined,
    createToolSearchExtension: () => () => undefined,
    createBashToolDefinition: () => ({ name: 'bash' }),
    createAgentSession: mocks.createAgentSession
  })
}))

const { PiRuntimeConnection } = await import('./PiRuntimeConnection')
const input = { sessionId: 'session-a', agentId: 'agent', modelId: 'provider::model' as const }
let root: string
let workspacePath: string
let snapshot: PiConnectionSnapshot

beforeEach(async () => {
  vi.resetAllMocks()
  root = await mkdtemp(path.join(tmpdir(), 'cherry-pi-workspace-'))
  workspacePath = path.join(root, 'system', '2026-10-15', input.sessionId)
  mocks.getPath.mockImplementation((key: string, filename?: string) => {
    const directory = key === 'feature.agents.system_workspaces' ? path.join(root, 'system') : path.join(root, key)
    return filename ? path.join(directory, filename) : directory
  })
  snapshot = {
    agent: { id: input.agentId, model: input.modelId, mcps: [] },
    session: {
      id: input.sessionId,
      agentId: input.agentId,
      workspace: { type: 'system', path: workspacePath }
    },
    provider: { id: 'provider' },
    model: { id: input.modelId },
    enabledApiKeys: [],
    additionalSkillPaths: [],
    mcpServerSnapshots: new Map(),
    linkedChannel: null,
    effectiveLanguage: null,
    signature: 'captured-a'
  } as unknown as PiConnectionSnapshot
  mocks.capture.mockImplementation(async () => snapshot)
  mocks.resolveInjection.mockResolvedValue({ providerName: 'provider', api: 'openai-completions', modelId: 'model' })
  mocks.buildPrompt.mockResolvedValue({ base: { kind: 'native' } })
  mocks.createAgentSession.mockResolvedValue({
    session: {
      bindExtensions: async () => undefined,
      subscribe: () => () => undefined,
      abort: async () => undefined,
      extensionRunner: { emit: async () => undefined },
      dispose: () => undefined
    }
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('materializes missing system ancestors before prompt and SDK consumers read the captured cwd', async () => {
  expect(existsSync(path.dirname(workspacePath))).toBe(false)
  mocks.buildPrompt.mockImplementation(async ({ workspacePath: cwd }) => {
    expect(cwd).toBe(workspacePath)
    expect(statSync(cwd).isDirectory()).toBe(true)
    return { base: { kind: 'native' } }
  })
  const createSession = mocks.createAgentSession.getMockImplementation()!
  mocks.createAgentSession.mockImplementation(async (options) => {
    expect(options.cwd).toBe(workspacePath)
    expect(statSync(options.cwd).isDirectory()).toBe(true)
    return createSession(options)
  })
  const connection = await new PiRuntimeConnection(input).start()
  await connection.close()
})

it('rejects a missing user workspace with the actionable error without recreating it', async () => {
  snapshot.session.workspace.type = 'user'
  await expect(new PiRuntimeConnection(input).start()).rejects.toSatisfy((error: unknown) => {
    expect(error).toBeInstanceOf(AgentSessionWorkspaceError)
    expect(error).toMatchObject({
      message: t('agent.session.workspace_status.missing', { path: workspacePath }),
      retryable: false
    })
    return true
  })
  expect(existsSync(workspacePath)).toBe(false)
  expect(mocks.buildPrompt).not.toHaveBeenCalled()
  expect(mocks.createAgentSession).not.toHaveBeenCalled()
})

it('prepares captured workspace A even when a fresh session lookup would return B', async () => {
  const workspaceB = path.join(root, 'system', '2026-10-15', 'session-b')
  mocks.getById.mockReturnValue({
    ...snapshot.session,
    workspace: { ...snapshot.session.workspace, path: workspaceB }
  })
  mocks.buildPrompt.mockImplementation(async ({ workspacePath: cwd }) => {
    expect(cwd).toBe(workspacePath)
    expect(statSync(cwd).isDirectory()).toBe(true)
    return { base: { kind: 'native' } }
  })
  const connection = await new PiRuntimeConnection(input).start()
  expect(existsSync(workspacePath)).toBe(true)
  expect(existsSync(workspaceB)).toBe(false)
  expect(mocks.getById).not.toHaveBeenCalled()
  expect(mocks.capture).toHaveBeenCalledTimes(3)
  await connection.close()
})

it('rejects workspace drift during prompt construction before creating an SDK session', async () => {
  mocks.buildPrompt.mockImplementation(async () => {
    expect(statSync(workspacePath).isDirectory()).toBe(true)
    snapshot = {
      ...snapshot,
      session: { ...snapshot.session, workspace: { ...snapshot.session.workspace, path: path.join(root, 'b') } },
      signature: 'changed-b'
    }
    return { base: { kind: 'native' } }
  })
  await expect(new PiRuntimeConnection(input).start()).rejects.toThrow(
    `Pi connection materialization changed during startup: ${input.sessionId}`
  )
  expect(mocks.createAgentSession).not.toHaveBeenCalled()
})
