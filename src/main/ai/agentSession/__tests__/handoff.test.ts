import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable as sessionTable } from '@data/db/schemas/agentSession'
import { messageTable } from '@data/db/schemas/message'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { messageService } from '@data/services/MessageService'
import { temporaryChatService } from '@data/services/TemporaryChatService'
import { topicService } from '@data/services/TopicService'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildHandoffPrompt, collectHandoffMaterial, prepareHandoffDraft, streamHandoffDraft } from '../handoff'

const stream = vi.hoisted(() => ({ start: vi.fn(), abort: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const services = { ...defaultServiceInstances, AiStreamManager: { streamPrompt: stream.start, abort: stream.abort } }
  return mockApplicationFactory(services)
})

describe('handoff material', () => {
  const dbh = setupTestDatabase()
  let topicNumber = 0
  let temporaryTopicId: string | undefined

  beforeEach(() => {
    topicNumber += 1
    temporaryTopicId = undefined
    stream.start.mockReset().mockReturnValue({ mode: 'started', activeExecutions: [] })
    stream.abort.mockReset()
  })

  function createSummaryModel(contextWindow = 100_000) {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'handoff-provider',
        presetProviderId: 'openai',
        name: 'Summary',
        orderKey: 'a0',
        isEnabled: true
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'handoff-provider::summary',
        providerId: 'handoff-provider',
        modelId: 'summary',
        name: 'Summary',
        capabilities: [],
        supportsStreaming: true,
        contextWindow,
        orderKey: 'a0'
      })
      .run()
    return 'handoff-provider::summary' as const
  }

  it('generates and cancels from real history without writing a source message or target session', async () => {
    const summaryModelId = createSummaryModel()
    const topic = topicService.create({ name: 'Long investigation' })
    const history = `Exact failure: E_HANDOFF_42. ${'historical context '.repeat(3_000)}`
    messageService.create(topic.id, {
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: history }] }
    })
    const beforeMessages = dbh.db.select().from(messageTable).all()
    const beforeSessions = dbh.db.select().from(sessionTable).all()
    const handle = streamHandoffDraft({
      sourceSessionId: topic.id,
      task: 'Fix the verified failure; do not deploy.',
      summaryModelId,
      target: { agentId: 'target', name: 'Builder' },
      listener: { id: 'test', onChunk() {}, onDone() {}, onError() {}, onPaused() {}, isAlive: () => true }
    })
    const result = await handle.ready
    expect(result.cancelled).toBe(false)
    expect(result.draft.prompt).toContain(history)
    expect(result.draft.prompt.length).toBeGreaterThan(40_000)
    expect(result.draft.prompt).toContain('do not deploy')
    const request = stream.start.mock.calls[0][0]
    expect(request.callOverrides).toEqual({ maxOutputTokens: result.draft.outputReservation })
    expect(request).not.toHaveProperty('tools')
    expect(request).not.toHaveProperty('assistantId')
    handle.cancel()
    expect(dbh.db.select().from(messageTable).all()).toEqual(beforeMessages)
    expect(dbh.db.select().from(sessionTable).all()).toEqual(beforeSessions)
  })

  it('rejects over-capacity history without truncating it or starting a stream', async () => {
    const summaryModelId = createSummaryModel(100)
    const topic = topicService.create({ name: 'Capacity' })
    const message = messageService.create(topic.id, {
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'history '.repeat(2_000) }] }
    })
    const beforeMessage = messageService.getById(message.id)
    await expect(
      prepareHandoffDraft({
        sourceSessionId: topic.id,
        task: 'continue',
        target: { agentId: 'target', name: 'Builder' },
        summaryModelId
      })
    ).rejects.toMatchObject({ code: 'PROMPT_OVER_CAPACITY' })
    expect(messageService.getById(message.id)).toEqual(beforeMessage)
    expect(stream.start).not.toHaveBeenCalled()
  })

  it('does not replace an explicitly selected missing model with the valid source model', async () => {
    const modelId = createSummaryModel()
    const topic = topicService.create({ name: 'Explicit model' })
    messageService.create(topic.id, {
      role: 'assistant',
      status: 'success',
      modelId,
      data: { parts: [{ type: 'text', text: 'verified result' }] }
    })
    await expect(
      prepareHandoffDraft({
        sourceSessionId: topic.id,
        task: 'continue',
        target: { agentId: 'target', name: 'Builder' },
        summaryModelId: 'missing::model'
      })
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' })
    expect(stream.start).not.toHaveBeenCalled()
  })

  afterEach(() => {
    if (temporaryTopicId && temporaryChatService.hasTopic(temporaryTopicId))
      temporaryChatService.deleteTopic(temporaryTopicId)
  })

  it('reads a real current branch through pagination and restores chronological order', () => {
    const topic = topicService.create({ name: `handoff pagination ${topicNumber}` })
    const messageIds: string[] = []
    let parentId: string | undefined
    for (let index = 1; index <= 400; index += 1) {
      const message = messageService.create(topic.id, {
        role: index % 2 === 0 ? 'assistant' : 'user',
        data: { parts: [{ type: 'text', text: `message ${index}` }] },
        status: 'success',
        ...(parentId ? { parentId } : {})
      })
      messageIds.push(message.id)
      parentId = message.id
    }

    const material = collectHandoffMaterial({ sourceSessionId: topic.id })

    expect(material.messages).toHaveLength(400)
    expect(material.messages.map((message) => message.id)).toEqual(messageIds)
  })

  it('preserves evidence references while excluding private reasoning from a quoted prompt', () => {
    const topic = topicService.create({ name: `handoff evidence ${topicNumber}` })
    messageService.create(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Investigate the failure.' }] },
      status: 'success'
    })
    messageService.create(topic.id, {
      role: 'assistant',
      data: {
        parts: [
          { type: 'reasoning', text: 'private reasoning' },
          {
            type: 'tool-read_file',
            toolCallId: 'call-1',
            state: 'output-available',
            output: { $persistedToolOutput: { fileEntryId: 'blob-1', head: 'head', tail: 'tail' } }
          }
        ]
      } as never,
      status: 'success'
    })

    const material = collectHandoffMaterial({ sourceSessionId: topic.id })
    const prompt = buildHandoffPrompt({
      task: 'Continue the investigation and fix the remaining issue.',
      target: { agentId: 'agent-1', name: 'Builder' },
      material
    })

    expect(material.coverage).toMatchObject({ messageCount: 2, attachmentCount: 0, toolPartCount: 1 })
    expect(prompt).toContain('Continue the investigation and fix the remaining issue.')
    expect(prompt).toContain('blob-1')
    expect(prompt).toContain('"omitted":true')
    expect(prompt).toContain('quoted evidence')
  })

  it('returns deduplicated standard file parts from user messages', () => {
    const topic = topicService.create({ name: `handoff attachments ${topicNumber}` })
    const attachment = {
      type: 'file' as const,
      mediaType: 'text/plain',
      url: 'file:///tmp/source.txt',
      filename: 'source.txt',
      providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
    }
    messageService.create(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'use this' }, attachment, { ...attachment, filename: 'renamed.txt' }] },
      status: 'success'
    })
    messageService.create(topic.id, {
      role: 'assistant',
      data: { parts: [attachment] },
      status: 'success'
    })

    const material = collectHandoffMaterial({ sourceSessionId: topic.id })
    expect(material.attachments).toEqual([attachment])
    expect(material.coverage.attachmentCount).toBe(1)
  })

  it('reads Agent and temporary sources with their own query contracts without creating either source', () => {
    const agentId = `handoff-agent-${topicNumber}`
    dbh.db
      .insert(agentTable)
      .values({ id: agentId, type: 'claude-code', name: 'Handoff Agent', instructions: '', orderKey: agentId })
      .run()
    const workspace = agentWorkspaceService.findOrCreateByPath(`/tmp/cherry-handoff-${topicNumber}`)
    const session = agentSessionService.create({
      agentId,
      name: 'Handoff source',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    agentSessionMessageService.saveMessages({
      sessionId: session.id,
      messages: [{ role: 'user', data: { parts: [{ type: 'text', text: 'Agent source' }] }, status: 'success' }]
    })
    const agentMaterial = collectHandoffMaterial({ sourceSessionId: session.id })
    expect(agentMaterial.source).toBe('agent')
    expect(agentMaterial.coverage.messageCount).toBe(1)

    const temporary = temporaryChatService.createTopic({ name: 'Handoff temporary source' })
    temporaryTopicId = temporary.id
    const temporaryMessage = temporaryChatService.appendMessage(temporary.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Temporary source' }] },
      status: 'success'
    })
    const temporaryMaterial = collectHandoffMaterial({ sourceSessionId: temporary.id })
    expect(temporaryMaterial).toMatchObject({
      source: 'temporary',
      sessionId: temporary.id,
      coverage: { messageIds: [temporaryMessage.id] }
    })
  })
})
