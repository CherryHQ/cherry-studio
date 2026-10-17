import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  applyAssistantEvents,
  assistantMethods,
  encodeAssistantCheckpointPage,
  encodeAssistantCommand,
  installAssistantCheckpoint,
  type AssistantBatch,
  type AssistantCheckpointPage,
  type AssistantProjection
} from '../src/assistant'

const integrity = { sha256: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex') }
const state = (): AssistantProjection => ({
  cursor: { topicId: 'topic', streamEpoch: 'epoch', seq: '0' },
  topic: {
    topicId: 'topic',
    assistantId: 'assistant',
    parentAnchorId: null,
    historyRevision: '1',
    activeExecutionIds: [],
    title: 'Conversation',
    updatedAt: '2026-10-14T00:00:00Z'
  },
  messages: {},
  parts: {},
  executions: {},
  interactions: {}
})
const batch = (events: AssistantBatch['events']): AssistantBatch => ({
  subscriptionId: 'sub',
  topicId: 'topic',
  streamEpoch: 'epoch',
  events
})

describe('Assistant remote contract', () => {
  it('requires explicit branch, configuration and history state and refuses controls outside the first increment', () => {
    const valid = {
      commandId: 'command',
      topicId: 'topic',
      assistantId: 'assistant',
      expectedAssistantRevision: 'a'.repeat(64),
      parentAnchorId: null,
      expectedHistoryRevision: '1',
      text: 'Hello'
    }
    const schema = assistantMethods['assistant.messages.send'].params
    expect(schema.safeParse(valid).success).toBe(true)
    for (const field of ['parentAnchorId', 'expectedHistoryRevision', 'expectedAssistantRevision']) {
      const incomplete = { ...valid } as Record<string, unknown>
      delete incomplete[field]
      expect(schema.safeParse(incomplete).success).toBe(false)
    }
    expect(schema.safeParse({ ...valid, text: ' ' }).success).toBe(false)
    expect(schema.safeParse({ ...valid, modelId: 'other' }).success).toBe(false)
    expect(schema.safeParse({ ...valid, attachments: [] }).success).toBe(false)
    const encoded = encodeAssistantCommand('assistant.messages.send', valid)
    expect(encodeAssistantCommand('assistant.messages.send', { ...valid, commandId: 'retry-id' })).toEqual(encoded)
    expect(encodeAssistantCommand('assistant.messages.send', { ...valid, parentAnchorId: 'new-branch' })).not.toEqual(
      encoded
    )
  })

  it('accepts uploaded files without text and binds the references to command identity', () => {
    const send = {
      commandId: 'command',
      topicId: 'topic',
      assistantId: 'assistant',
      expectedAssistantRevision: 'a'.repeat(64),
      parentAnchorId: null,
      expectedHistoryRevision: '1',
      text: ''
    }
    const schema = assistantMethods['assistant.messages.send'].params
    expect(schema.safeParse(send).success).toBe(false)
    expect(schema.parse({ ...send, attachments: [{ uploadId: 'a' }], selectionId: 'draft' }).attachments).toEqual([
      { uploadId: 'a' }
    ])
    for (const attachments of [[{ uploadId: 'a' }, { uploadId: 'a' }], [{ path: '/etc/passwd' }]])
      expect(schema.safeParse({ ...send, attachments }).success).toBe(false)
    expect(
      encodeAssistantCommand('assistant.messages.send', { ...send, attachments: [{ uploadId: 'a' }] })
    ).not.toEqual(encodeAssistantCommand('assistant.messages.send', { ...send, attachments: [{ uploadId: 'b' }] }))
    const presence = assistantMethods['assistant.attachments.present'].params
    const item = {
      attachmentId: 'a',
      uploadId: 'a',
      filename: 'report.pdf',
      mediaType: 'application/pdf',
      byteLength: 1
    }
    expect(presence.safeParse({ selectionId: 'draft', topicId: 'topic', sequence: '1', items: [item] }).success).toBe(
      true
    )
    expect(presence.safeParse({ selectionId: 'draft', sessionId: 'topic', sequence: '1', items: [item] }).success).toBe(
      false
    )
  })

  it('keeps simultaneous model replies separate and applies replay atomically with UTF-8 offsets', () => {
    const original = state()
    const initial = batch([
      {
        seq: '1',
        kind: 'message.updated',
        message: {
          messageId: 'one',
          parentId: 'question',
          revision: '1',
          role: 'assistant',
          status: 'pending',
          partIds: ['one:text']
        }
      },
      {
        seq: '2',
        kind: 'message.updated',
        message: {
          messageId: 'two',
          parentId: 'question',
          revision: '2',
          role: 'assistant',
          status: 'pending',
          partIds: ['two:text']
        }
      },
      {
        seq: '3',
        kind: 'part.updated',
        messageId: 'one',
        afterPartId: null,
        part: {
          partId: 'one:text',
          revision: '3',
          kind: 'text',
          state: 'streaming',
          content: { text: '你' },
          executionId: 'run-one'
        }
      },
      {
        seq: '4',
        kind: 'part.updated',
        messageId: 'two',
        afterPartId: null,
        part: {
          partId: 'two:text',
          revision: '4',
          kind: 'text',
          state: 'streaming',
          content: { text: 'Another answer' },
          executionId: 'run-two'
        }
      },
      {
        seq: '5',
        kind: 'part.append',
        messageId: 'one',
        partId: 'one:text',
        baseRevision: '3',
        revision: '5',
        offsetUtf8: '3',
        text: '好'
      }
    ])
    const result = applyAssistantEvents(original, initial, {}, integrity)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.projection.parts['one:text']).toMatchObject({ executionId: 'run-one', content: { text: '你好' } })
    expect(result.projection.parts['two:text']).toMatchObject({
      executionId: 'run-two',
      content: { text: 'Another answer' }
    })
    expect(original.parts).toEqual({})
    expect(applyAssistantEvents(result.projection, initial, {}, integrity)).toMatchObject({
      ok: true,
      cursor: { seq: '5' }
    })
    expect(
      applyAssistantEvents(
        result.projection,
        batch([{ seq: '7', kind: 'message.removed', messageId: 'one' }]),
        {},
        integrity
      )
    ).toEqual({ ok: false, reason: 'gap' })
    expect(result.projection.messages.one).toBeDefined()
    for (const afterPartId of ['missing', 'two:text', 'one:text']) {
      expect(
        applyAssistantEvents(
          result.projection,
          batch([
            {
              seq: '6',
              kind: 'part.updated',
              messageId: 'one',
              afterPartId,
              part: { ...result.projection.parts['one:text'], revision: '6' }
            }
          ]),
          {},
          integrity
        )
      ).toEqual({ ok: false, reason: 'revision' })
    }
    expect(result.projection.messages.one.partIds).toEqual(['one:text'])
    expect(result.projection.parts['one:text'].revision).toBe('5')
  })

  it('rejects altered or incomplete checkpoints before publishing a replacement projection', () => {
    const page: AssistantCheckpointPage = {
      checkpointId: 'checkpoint',
      pageIndex: 0,
      items: [{ kind: 'topic', value: state().topic }],
      nextCursor: null,
      pageDigest: '0'.repeat(64)
    }
    const bytes = encodeAssistantCheckpointPage(page)
    page.pageDigest = integrity.sha256(bytes)
    const descriptor = {
      checkpointId: page.checkpointId,
      cursor: state().cursor,
      historyRevision: '1',
      pageCount: 1,
      byteLength: String(bytes.length),
      sha256: integrity.sha256(bytes),
      expiresAt: '2026-10-14T00:05:00Z'
    }
    expect(installAssistantCheckpoint(descriptor, [page], {}, integrity)).toMatchObject({
      ok: true,
      projection: { topic: state().topic }
    })
    expect(installAssistantCheckpoint(descriptor, [], {}, integrity)).toEqual({ ok: false, reason: 'incomplete' })
    expect(
      installAssistantCheckpoint(
        descriptor,
        [{ ...page, items: [{ kind: 'topic', value: { ...state().topic, title: 'Tampered' } }] }],
        {},
        integrity
      )
    ).toEqual({ ok: false, reason: 'digest' })
    expect(
      installAssistantCheckpoint(
        { ...descriptor, cursor: { ...descriptor.cursor, topicId: 'another' } },
        [page],
        {},
        integrity
      )
    ).toEqual({ ok: false, reason: 'invalid' })
  })

  it('requires verified UTF-8 content before installing a streamed reference', () => {
    const text = '\uFEFF' + '🍒'.repeat(3000)
    const bytes = new TextEncoder().encode(text)
    const page: AssistantCheckpointPage = {
      checkpointId: 'checkpoint',
      pageIndex: 0,
      nextCursor: null,
      pageDigest: '0'.repeat(64),
      items: [
        { kind: 'topic', value: state().topic },
        {
          kind: 'message',
          value: {
            messageId: 'answer',
            parentId: null,
            revision: '1',
            role: 'assistant',
            status: 'pending',
            partIds: [],
            partCount: 1
          }
        },
        {
          kind: 'part',
          messageId: 'answer',
          value: {
            partId: 'answer:text',
            revision: '2',
            kind: 'text',
            state: 'streaming',
            content: {
              ref: {
                contentId: 'answer:text',
                revision: '2',
                byteLength: String(bytes.length),
                sha256: integrity.sha256(bytes),
                mediaType: 'text/plain'
              }
            }
          }
        }
      ]
    }
    const encoded = encodeAssistantCheckpointPage(page)
    page.pageDigest = integrity.sha256(encoded)
    const descriptor = {
      checkpointId: page.checkpointId,
      cursor: state().cursor,
      historyRevision: '1',
      pageCount: 1,
      byteLength: String(encoded.length),
      sha256: integrity.sha256(encoded),
      expiresAt: '2026-10-14T00:05:00Z'
    }
    expect(installAssistantCheckpoint(descriptor, [page], {}, integrity)).toEqual({ ok: false, reason: 'content' })
    expect(installAssistantCheckpoint(descriptor, [page], { 'answer:text:2': bytes.slice(1) }, integrity)).toEqual({
      ok: false,
      reason: 'content'
    })
    expect(
      installAssistantCheckpoint(descriptor, [page], { 'answer:text:2': new Uint8Array(bytes.length) }, integrity)
    ).toEqual({ ok: false, reason: 'content' })
    const installed = installAssistantCheckpoint(descriptor, [page], { 'answer:text:2': bytes }, integrity)
    expect(installed.ok).toBe(true)
    if (!installed.ok) throw new Error(installed.reason)
    expect(installed.projection.parts['answer:text']).toMatchObject({ content: { text } })
    const applied = applyAssistantEvents(
      installed.projection,
      batch([
        {
          kind: 'part.append',
          seq: '1',
          messageId: 'answer',
          partId: 'answer:text',
          baseRevision: '2',
          revision: '3',
          offsetUtf8: String(bytes.length),
          text: ' More'
        }
      ]),
      {},
      integrity
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) throw new Error(applied.reason)
    expect(applied.projection.parts['answer:text']).toMatchObject({ content: { text: text + ' More' } })
    const invalid = Uint8Array.of(255)
    const item = page.items[2]
    if (item.kind !== 'part' || item.value.kind !== 'text') throw new Error('Expected text')
    item.value.content = {
      ref: {
        contentId: 'answer:text',
        revision: '2',
        byteLength: '1',
        sha256: integrity.sha256(invalid),
        mediaType: 'text/plain'
      }
    }
    const invalidPageBytes = encodeAssistantCheckpointPage(page)
    page.pageDigest = integrity.sha256(invalidPageBytes)
    expect(
      installAssistantCheckpoint(
        { ...descriptor, byteLength: String(invalidPageBytes.length), sha256: integrity.sha256(invalidPageBytes) },
        [page],
        { 'answer:text:2': invalid },
        integrity
      )
    ).toEqual({ ok: false, reason: 'content' })
  })
})
