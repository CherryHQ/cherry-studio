import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { BaseService } from '@main/core/lifecycle/BaseService'

import type { DispatchContext } from '../context/ChatContextProvider'
import type { MainDispatchRequest } from '../context/dispatch'
import type { StreamListener } from '../types'

const effects = vi.hoisted(() => ({ dispatch: vi.fn() }))
vi.mock('../context/dispatch', () => ({ dispatchStreamRequest: effects.dispatch }))
const { AiStreamManager } = await import('../AiStreamManager')

describe('Assistant approval without an Electron window', () => {
  setupTestDatabase()
  let manager: InstanceType<typeof AiStreamManager>
  const observer: StreamListener = {
    id: 'remote-observer',
    onChunk() {},
    onDone() {},
    onPaused() {},
    onError() {},
    isAlive: () => true
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    manager = new AiStreamManager()
    await (manager as unknown as { onInit(): Promise<void> }).onInit()
    effects.dispatch.mockImplementation(
      async (_manager: unknown, _subscriber: unknown, _req: MainDispatchRequest, admission: DispatchContext) => {
        admission.beforePersist?.()
        admission.beforeActivate?.()
        return { mode: 'started' }
      }
    )
  })
  afterEach(() => BaseService.resetInstances())

  function pendingApproval() {
    const topic = topicService.create({ name: 'Approval topic' })
    const user = messageService.create(topic.id, {
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Write a file' }] }
    })
    const anchor = messageService.create(topic.id, {
      role: 'assistant',
      parentId: user.id,
      status: 'success',
      data: {
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'mcp_write',
            toolCallId: 'call',
            state: 'approval-requested',
            input: { path: 'example.txt' },
            approval: { id: 'approval' }
          }
        ]
      }
    })
    return {
      topic,
      anchor,
      payload: { topicId: topic.id, anchorId: anchor.id, approvalId: 'approval', approved: true }
    }
  }

  it('settles concurrent desktop and remote decisions once and resumes with the committed approval', async () => {
    const { anchor, payload } = pendingApproval()
    effects.dispatch.mockImplementation(
      async (_manager: unknown, _subscriber: unknown, req: MainDispatchRequest, admission: DispatchContext) => {
        if (req.trigger !== 'continue-conversation') throw new Error('Expected continuation')
        admission.beforePersist?.()
        admission.beforeActivate?.()
        const persisted = messageService.getById(anchor.id)
        const part = persisted.data.parts?.[0] as { approval?: { approved?: boolean } }
        if (!part.approval?.approved) throw new Error('Tool ran before its decision was committed')
        messageService.finalizeAssistantMessage(anchor.id, {
          status: 'success',
          data: { parts: [...persisted.data.parts!, { type: 'text', text: 'File written' }] }
        })
        return { mode: 'started' }
      }
    )
    const results = await Promise.all([
      manager.respondAssistantToolApproval(payload, observer),
      manager.respondAssistantToolApproval(payload, { ...observer, id: 'desktop-observer' })
    ])
    expect(results).toEqual([{ ok: true }, { ok: true }])
    expect(messageService.getById(anchor.id).data.parts?.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'File written' }
    ])
  })

  it('rejects a stale input before changing a persisted decision', async () => {
    const { anchor, payload } = pendingApproval()
    await expect(
      manager.respondAssistantToolApproval(payload, observer, {
        beforeDecision: () => {
          throw new Error('Approval revision changed')
        }
      })
    ).rejects.toThrow('Approval revision changed')
    expect(messageService.getById(anchor.id).data.parts?.[0]).toMatchObject({
      state: 'approval-requested',
      approval: { id: 'approval' }
    })
  })

  it('rolls back an approval when its durable command association fails', async () => {
    const { anchor, payload } = pendingApproval()
    await expect(
      manager.respondAssistantToolApproval(payload, observer, {
        onDecisionPersist: () => {
          throw new Error('Receipt write failed')
        }
      })
    ).rejects.toThrow('Receipt write failed')
    expect(messageService.getById(anchor.id).data.parts?.[0]).toMatchObject({
      state: 'approval-requested',
      approval: { id: 'approval' }
    })
    expect(messageService.getById(anchor.id).status).toBe('success')
  })

  it.each([false, true])('resumes a retained approval pause with queued work=%s', async (queued) => {
    const { topic, anchor, payload } = pendingApproval()
    const streams = (manager as unknown as { activeStreams: Map<string, { status: string }> }).activeStreams
    streams.set(topic.id, { status: 'awaiting-approval' })
    if (queued) manager.enqueuePendingSteer(topic.id, anchor.parentId!)
    expect(await manager.respondAssistantToolApproval(payload, observer)).toEqual({ ok: true })
    expect(messageService.getById(anchor.id)).toMatchObject({
      status: 'pending',
      data: { parts: [{ state: 'approval-responded', approval: { approved: true } }] }
    })
    expect(manager.hasPendingSteer(topic.id)).toBe(queued)
  })

  it.each(['pending', 'streaming'])('does not consume approval while another stream is %s', async (status) => {
    const { topic, anchor, payload } = pendingApproval()
    const streams = (manager as unknown as { activeStreams: Map<string, { status: string }> }).activeStreams
    streams.set(topic.id, { status })
    expect(await manager.respondAssistantToolApproval(payload, observer)).toEqual({ ok: false })
    expect(messageService.getById(anchor.id).data.parts?.[0]).toMatchObject({ state: 'approval-requested' })
  })

  it('preserves the pending approval and allows a real retry after a branch conflict during preparation', async () => {
    const { topic, anchor, payload } = pendingApproval()
    const sibling = messageService.create(topic.id, {
      role: 'assistant',
      parentId: anchor.parentId,
      setAsActive: false,
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Another branch' }] }
    })
    effects.dispatch.mockImplementationOnce(
      async (_manager: unknown, _subscriber: unknown, _req: MainDispatchRequest, admission: DispatchContext) => {
        admission.beforePersist?.()
        await Promise.resolve()
        topicService.setActiveNode(topic.id, sibling.id)
        admission.beforeActivate?.()
        return { mode: 'started' }
      }
    )
    await expect(manager.respondAssistantToolApproval(payload, observer)).rejects.toThrow('Conversation changed')
    expect(messageService.getById(anchor.id)).toMatchObject({
      status: 'success',
      data: { parts: [{ state: 'approval-requested', approval: { id: 'approval' } }] }
    })
    topicService.setActiveNode(topic.id, anchor.id)
    expect(await manager.respondAssistantToolApproval(payload, observer)).toEqual({ ok: true })
    expect(messageService.getById(anchor.id)).toMatchObject({
      status: 'pending',
      data: { parts: [{ state: 'approval-responded', approval: { approved: true } }] }
    })
  })

  it('keeps an unanswered sibling approval pending without running the tool', async () => {
    const { anchor, payload } = pendingApproval()
    const existing = messageService.getById(anchor.id)
    messageService.update(anchor.id, {
      data: {
        parts: [
          ...existing.data.parts!,
          {
            type: 'dynamic-tool',
            toolName: 'mcp_read',
            toolCallId: 'other-call',
            state: 'approval-requested',
            input: {},
            approval: { id: 'other-approval' }
          }
        ]
      }
    })
    effects.dispatch.mockImplementation(() => {
      throw new Error('Cannot run while another decision is pending')
    })
    expect(await manager.respondAssistantToolApproval(payload, observer)).toEqual({ ok: true })
    expect(messageService.getById(anchor.id).data.parts).toMatchObject([
      { state: 'approval-responded', approval: { id: 'approval', approved: true } },
      { state: 'approval-requested', approval: { id: 'other-approval' } }
    ])
  })
})
