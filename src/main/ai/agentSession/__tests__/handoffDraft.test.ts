import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable as sessionTable } from '@data/db/schemas/agentSession'
import { messageTable } from '@data/db/schemas/message'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openHandoffDraft } from '../handoffDraft'

const stream = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const services = { ...defaultServiceInstances, AiStreamManager: { streamPrompt: stream.start } }
  return mockApplicationFactory(services)
})

const listener = { id: 'test', onChunk() {}, onDone() {}, onError() {}, onPaused() {}, isAlive: () => true }
const streamId = 'handoff:draft:00000000-0000-4000-8000-000000000001'

describe('openHandoffDraft', () => {
  const dbh = setupTestDatabase()
  let topicNumber = 0

  beforeEach(() => {
    topicNumber += 1
    stream.start.mockReset().mockReturnValue({ mode: 'started', activeExecutions: [] })
    dbh.db
      .insert(agentTable)
      .values({ id: 'target', type: 'claude-code', name: 'Builder', instructions: '', orderKey: 'a0' })
      .run()
  })

  function createSummaryModel(contextWindow: number | null = 100_000) {
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

  it.each([100, null])(
    'streams full history without writes or local truncation with a catalog window of %s',
    (capacity) => {
      const summaryModelId = createSummaryModel(capacity)
      const topic = topicService.create({ name: 'Long investigation' })
      const history = `Exact failure: E_HANDOFF_42. ${'historical context '.repeat(3_000)}`
      messageService.create(topic.id, {
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: history }] }
      })
      const beforeMessages = dbh.db.select().from(messageTable).all()
      const beforeSessions = dbh.db.select().from(sessionTable).all()
      const metadata = openHandoffDraft(
        {
          sourceSessionId: topic.id,
          task: 'Fix the failure; do not deploy.',
          summaryModelId,
          targetAgentId: 'target',
          streamId
        },
        listener
      )
      const request = stream.start.mock.calls[0][0]
      expect(metadata).toEqual({ modelId: summaryModelId, messageCount: 1, attachments: [] })
      expect(request.prompt).toContain(history)
      expect(request.prompt).toContain('do not deploy')
      expect(request.prompt).toContain('Builder (target)')
      expect(request).toMatchObject({ streamId, contextOwner: 'caller', reasoningEffort: 'none', maxRetries: 0 })
      expect(request).not.toHaveProperty('tools')
      expect(request).not.toHaveProperty('assistantId')
      expect(dbh.db.select().from(messageTable).all()).toEqual(beforeMessages)
      expect(dbh.db.select().from(sessionTable).all()).toEqual(beforeSessions)
    }
  )

  it('does not register a model request for a closed window', () => {
    const summaryModelId = createSummaryModel()
    const topic = topicService.create({ name: 'Closed window' })
    openHandoffDraft(
      { sourceSessionId: topic.id, targetAgentId: 'target', task: 'continue', streamId, summaryModelId },
      { ...listener, isAlive: () => false }
    )
    expect(stream.start).not.toHaveBeenCalled()
  })

  it('reports a deleted source and rejects an oversized task without starting a stream', () => {
    expect(() =>
      openHandoffDraft({ sourceSessionId: 'gone', targetAgentId: 'target', task: 'continue', streamId }, listener)
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }))
    expect(() =>
      openHandoffDraft(
        { sourceSessionId: 'gone', targetAgentId: 'target', task: 'x'.repeat(40_001), streamId },
        listener
      )
    ).toThrowError(expect.objectContaining({ code: 'PROMPT_TOO_LARGE' }))
    expect(stream.start).not.toHaveBeenCalled()
  })

  it('does not replace an explicitly selected missing model with the valid source model', () => {
    const modelId = createSummaryModel()
    const topic = topicService.create({ name: 'Explicit model' })
    messageService.create(topic.id, {
      role: 'assistant',
      status: 'success',
      modelId,
      data: { parts: [{ type: 'text', text: 'verified result' }] }
    })
    expect(() =>
      openHandoffDraft(
        {
          sourceSessionId: topic.id,
          task: 'continue',
          targetAgentId: 'target',
          streamId,
          summaryModelId: 'missing::model'
        },
        listener
      )
    ).toThrowError(expect.objectContaining({ code: 'MODEL_UNAVAILABLE' }))
    expect(stream.start).not.toHaveBeenCalled()
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

    openHandoffDraft(
      {
        sourceSessionId: topic.id,
        task: 'Continue the investigation and fix the remaining issue.',
        targetAgentId: 'target',
        summaryModelId: createSummaryModel(),
        streamId
      },
      listener
    )
    const prompt = stream.start.mock.calls[0][0].prompt
    expect(prompt).not.toContain('private reasoning')
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

    const metadata = openHandoffDraft(
      {
        sourceSessionId: topic.id,
        task: 'continue',
        targetAgentId: 'target',
        summaryModelId: createSummaryModel(),
        streamId
      },
      listener
    )
    expect(metadata.attachments).toEqual([attachment])
  })
})
