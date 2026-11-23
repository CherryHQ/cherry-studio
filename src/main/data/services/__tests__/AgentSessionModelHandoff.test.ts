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
import { generateModelSwitchHandoff } from '@main/ai/agents/modelSwitchHandoff'
import type { UniqueModelId } from '@shared/data/types/model'

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
    MockApplicationUtils.setService('AiService', { runTextRequest: generate })
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
