import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { generateModelSwitchHandoff } from '@main/ai/agents/modelSwitchHandoff'
import type { UniqueModelId } from '@shared/data/types/model'

const native = vi.hoisted(() => ({
  query: vi.fn(),
  buildEnvironment: vi.fn(async () => ({ CLAUDE_CONFIG_DIR: '/native-login' }))
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: native.query }))
vi.mock('@main/ai/runtime/claudeCode', () => ({
  buildEnvironment: native.buildEnvironment,
  resolveClaudeExecutablePath: () => '/native-claude',
  spawnClaudeCodeProcess: vi.fn()
}))

const previousModel = 'fixture::old' as UniqueModelId
const nextModel = 'fixture::new' as UniqueModelId
const generated = {
  objective: 'Finish the export',
  decisions: 'Keep CSV output',
  completedWork: 'Parser finished',
  pendingSteps: 'Add export coverage',
  relevantFiles: 'src/export.ts',
  unresolvedRisks: 'Large files not tested'
}

describe('model-switch handoff persistence and generation', () => {
  const dbh = setupTestDatabase()
  const busy = vi.fn(() => false)
  const generate = vi.fn(async () => ({ text: JSON.stringify(generated) }))
  let sessionId: string

  beforeEach(() => {
    MockApplicationUtils.setService('AgentSessionRuntimeService', { isSessionBusy: busy })
    MockApplicationUtils.setService('AiService', {
      runTextRequest: generate,
      runWithAbort: async (_id: string, operation: (signal: AbortSignal) => unknown) =>
        operation(new AbortController().signal)
    })
    native.query.mockReset()
    busy.mockReturnValue(false)
    generate.mockReset().mockResolvedValue({ text: JSON.stringify(generated) })
    dbh.db.insert(userProviderTable).values({ providerId: 'fixture', name: 'Fixture', orderKey: 'p0' }).run()
    for (const name of ['old', 'new'])
      dbh.db
        .insert(userModelTable)
        .values({
          id: `fixture::${name}`,
          providerId: 'fixture',
          modelId: name,
          name,
          capabilities: [],
          supportsStreaming: true,
          orderKey: name
        })
        .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'handoff-agent',
        type: 'claude-code',
        name: 'Handoff agent',
        instructions: 'Work on files',
        model: previousModel,
        orderKey: 'a0'
      })
      .run()
    const workspace = dbh.db.transaction((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, '/tmp/handoff-test'))
    sessionId = agentSessionService.create({
      agentId: 'handoff-agent',
      name: 'Task',
      workspace: { type: 'user', workspaceId: workspace.id }
    }).id
    agentSessionMessageService.saveMessages({
      sessionId,
      runtimeResumeToken: 'native-original',
      messages: [
        { role: 'user', data: { parts: [{ type: 'text', text: 'Finish export.ts' }] }, status: 'success' },
        {
          role: 'assistant',
          data: { parts: [{ type: 'text', text: 'Parser finished. Tests remain.' }] },
          status: 'success'
        }
      ]
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    MockApplicationUtils.resetServices()
  })
  const rows = () =>
    dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, sessionId)).all()
  const draft = () => {
    const { previousModel, sourceHead, sourceVersion } = agentSessionService.getModelSwitchSource(sessionId)
    return { previousModel, sourceHead, sourceVersion, nextModel, text: '  Edited handoff: test export.ts next.\n' }
  }

  it('atomically switches and saves exact edited system context with provenance without rewriting history', () => {
    const before = rows()
    const input = draft()
    expect(agentSessionService.switchModelWithHandoff(sessionId, input).model).toBe(nextModel)
    const after = rows()
    expect(after.filter((row) => before.some((old) => old.id === row.id))).toEqual(before)
    const saved = after.find((row) => !before.some((old) => old.id === row.id))!
    expect(saved).toMatchObject({
      role: 'system',
      parentId: input.sourceHead,
      data: {
        parts: [{ type: 'text', text: input.text }],
        modelSwitchHandoff: { previousModel, nextModel, sourceHead: input.sourceHead }
      }
    })
    expect(agentSessionService.getModelSwitchHandoff(sessionId)).toBe(input.text)
    expect(agentSessionService.getModelSwitchHandoff(sessionId, input.sourceHead)).toBeUndefined()
    expect(agentSessionService.getModelSwitchHandoff(sessionId, null)).toBeUndefined()
    expect(agentSessionMessageService.getLastRuntimeResumeToken(sessionId)).toBe('native-original')
  })

  it('rejects a stale branch and does not append or change the selected model', () => {
    const input = draft()
    agentSessionMessageService.saveMessages({
      sessionId,
      messages: [{ role: 'user', data: { parts: [{ type: 'text', text: 'New request' }] } }]
    })
    const before = rows()
    expect(() => agentSessionService.switchModelWithHandoff(sessionId, input)).toThrow(/Session changed/)
    expect(agentSessionService.getById(sessionId).model).toBeNull()
    expect(rows()).toEqual(before)
  })

  it('detects edits to source text even when the branch head stays the same', () => {
    const input = draft()
    dbh.db
      .update(agentSessionMessageTable)
      .set({ data: { parts: [{ type: 'text', text: 'Changed source' }] } })
      .where(eq(agentSessionMessageTable.id, input.sourceHead))
      .run()
    expect(() => agentSessionService.switchModelWithHandoff(sessionId, input)).toThrow(/Session changed/)
    expect(agentSessionService.getById(sessionId).model).toBeNull()
  })

  it('rolls back the model when handoff persistence fails', () => {
    const input = draft(),
      before = rows()
    vi.spyOn(agentSessionMessageService, 'saveMessagesTx').mockImplementationOnce(() => {
      throw new Error('Write failed')
    })
    expect(() => agentSessionService.switchModelWithHandoff(sessionId, input)).toThrow('Write failed')
    expect(agentSessionService.getById(sessionId).model).toBeNull()
    expect(rows()).toEqual(before)
  })

  it('refuses a run-start race without switching or appending', () => {
    const input = draft(),
      before = rows()
    busy.mockReturnValue(true)
    expect(() => agentSessionService.switchModelWithHandoff(sessionId, input)).toThrow(/idle/)
    expect(agentSessionService.getById(sessionId).model).toBeNull()
    expect(rows()).toEqual(before)
  })

  it('uses only the captured current model and separates the generated task sections without persistence', async () => {
    const before = rows()
    const result = await generateModelSwitchHandoff(sessionId, 'preview-request')
    expect(result.text).toBe(
      '## Objective\n\nFinish the export\n\n## Decisions\n\nKeep CSV output\n\n## Completed work\n\nParser finished\n\n## Pending steps\n\nAdd export coverage\n\n## Relevant files\n\nsrc/export.ts\n\n## Unresolved risks\n\nLarge files not tested'
    )
    const request = generate.mock.calls[0] as unknown as [
      string,
      { uniqueModelId: string; prompt: string; assistantId?: string; contextOwner: string }
    ]
    expect(request[1].uniqueModelId).toBe(previousModel)
    expect(request[1].contextOwner).toBe('caller')
    expect(request[1].assistantId).toBeUndefined()
    expect(request[1].prompt).toContain('Parser finished. Tests remain.')
    expect(agentSessionService.getById(sessionId).model).toBeNull()
    expect(rows()).toEqual(before)
  })

  it('uses CLI login without API keys for subscription-only handoff generation', async () => {
    vi.spyOn(providerService, 'getByProviderId').mockReturnValue({ authMethods: ['external-cli'] } as never)
    const close = vi.fn()
    native.query.mockReturnValue(
      Object.assign(
        (async function* () {
          yield { type: 'result', subtype: 'success', result: JSON.stringify(generated) }
        })(),
        { close }
      )
    )
    const result = await generateModelSwitchHandoff(sessionId, 'native-preview')
    expect(result.text).toContain('Finish the export')
    expect(generate).not.toHaveBeenCalled()
    expect(native.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          env: { CLAUDE_CONFIG_DIR: '/native-login' },
          tools: [],
          mcpServers: {},
          persistSession: false,
          spawnClaudeCodeProcess: expect.any(Function)
        })
      })
    )
    expect(close).toHaveBeenCalled()
  })

  it('enforces the explicit input cap even with a larger context window', async () => {
    vi.spyOn(modelService, 'getByKey').mockReturnValue({
      contextWindow: 131072,
      maxInputTokens: 8192,
      maxOutputTokens: 4096
    } as never)
    agentSessionMessageService.saveMessages({
      sessionId,
      messages: [{ role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'x'.repeat(9000) }] } }]
    })
    await expect(generateModelSwitchHandoff(sessionId, 'input-cap')).rejects.toThrow(/safe handoff input budget/)
    expect(generate).not.toHaveBeenCalled()
  })

  it('accepts a short history with an input cap and no context window', async () => {
    vi.spyOn(modelService, 'getByKey').mockReturnValue({ maxInputTokens: 131072, maxOutputTokens: 32768 } as never)
    await expect(generateModelSwitchHandoff(sessionId, 'input-only')).resolves.toMatchObject({ previousModel })
    expect(generate).toHaveBeenCalledOnce()
  })

  it('registers cancellation before CLI environment setup and never launches an aborted query', async () => {
    vi.spyOn(providerService, 'getByProviderId').mockReturnValue({ authMethods: ['external-cli'] } as never)
    const entered = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<{ CLAUDE_CONFIG_DIR: string }>()
    native.buildEnvironment.mockImplementationOnce(async () => {
      entered.resolve()
      return ready.promise
    })
    const controller = new AbortController()
    MockApplicationUtils.setService('AiService', {
      runWithAbort: async (_id: string, operation: (signal: AbortSignal) => unknown) => operation(controller.signal)
    })
    const pending = generateModelSwitchHandoff(sessionId, 'cancel-environment')
    await entered.promise
    controller.abort()
    ready.resolve({ CLAUDE_CONFIG_DIR: '/native-login' })
    await expect(pending).rejects.toThrow()
    expect(native.query).not.toHaveBeenCalled()
  })

  it('rejects oversized stored history before any dispatch instead of retrying it unbounded', async () => {
    vi.spyOn(modelService, 'getByKey').mockReturnValue({ contextWindow: 100, maxOutputTokens: 50 } as never)
    await expect(generateModelSwitchHandoff(sessionId, 'over-budget')).rejects.toThrow(/safe handoff input budget/)
    expect(generate).not.toHaveBeenCalled()
    expect(native.query).not.toHaveBeenCalled()
  })

  it('rejects an incomplete generated structure and a changed source during generation without saving', async () => {
    generate.mockResolvedValueOnce({ text: '{"objective":"Only one field"}' })
    await expect(generateModelSwitchHandoff(sessionId, 'invalid-preview')).rejects.toThrow()
    generate.mockImplementationOnce(async () => {
      agentSessionService.update(sessionId, { model: nextModel })
      return { text: JSON.stringify(generated) }
    })
    await expect(generateModelSwitchHandoff(sessionId, 'stale-preview')).rejects.toThrow(/Session changed/)
    expect(rows().filter((row) => row.role === 'system')).toEqual([])
  })
})
