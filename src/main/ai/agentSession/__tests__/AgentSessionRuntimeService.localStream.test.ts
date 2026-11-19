import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeEvent } from '@main/ai/runtime/types'
import { pipeMessageStream } from '@main/ai/streamManager/pipeMessageStream'
import { pipeStreamLoop } from '@main/ai/streamManager/pipeStreamLoop'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { CherryUIMessage } from '@shared/data/types/message'
import { AsyncEventQueue } from '@shared/utils/async'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'

const dbh = setupTestDatabase()
beforeEach(() => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
})

it.each(['success', 'error', 'live'] as const)(
  'accumulates and persists local chunks on %s without a native projection',
  async (status) => {
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'local', name: 'Local', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'root', agentId: 'agent', workspaceId: 'workspace', name: 'Root', orderKey: 'a0' })
      .run()
    const user = messages.saveMessage({
      sessionId: 'root',
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Prompt' }] } }
    })
    const reply = messages.saveMessage({
      sessionId: 'root',
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    const events = new AsyncEventQueue<AgentRuntimeEvent>()
    const failure = new Error('Local process failed')
    const release = Promise.withResolvers<void>()
    onTestFinished(() => release.resolve())
    runtimeDriverRegistry.register({
      type: 'local',
      contentSource: 'chunks',
      validateSession: () => {},
      connect: async () => ({
        events,
        send: async () => {
          events.push({ type: 'chunk', chunk: { type: 'start' } })
          events.push({ type: 'chunk', chunk: { type: 'reasoning-start', id: 'reason' } })
          events.push({ type: 'chunk', chunk: { type: 'reasoning-delta', id: 'reason', delta: 'Thinking' } })
          events.push({ type: 'chunk', chunk: { type: 'reasoning-end', id: 'reason' } })
          events.push({ type: 'chunk', chunk: { type: 'text-start', id: 'text' } })
          events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 'text', delta: 'Hello ' } })
          events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 'text', delta: 'local' } })
          if (status === 'live') await release.promise
          events.push({ type: 'chunk', chunk: { type: 'text-end', id: 'text' } })
          events.push({
            type: 'chunk',
            chunk: {
              type: 'tool-input-available',
              toolCallId: 'tool',
              toolName: 'Read',
              input: { path: 'a' },
              dynamic: true
            }
          })
          events.push({
            type: 'chunk',
            chunk: { type: 'tool-output-available', toolCallId: 'tool', output: 'contents', dynamic: true }
          })
          if (status === 'error') events.push({ type: 'error', error: failure })
          else {
            events.push({ type: 'chunk', chunk: { type: 'finish', finishReason: 'stop' } })
            events.push({ type: 'turn-complete' })
          }
        },
        close: async () => {
          events.close()
        },
        reconcile: async () => 'current'
      })
    })
    const service = new AgentSessionRuntimeService()
    onTestFinished(async () => {
      await service.closeSession('root')
      runtimeDriverRegistry.clearForTest()
      MockApplicationUtils.resetServices()
      vi.restoreAllMocks()
    })
    const handle = service.beginTurn({
      sessionId: 'root',
      topicId: 'agent-session:root',
      agentId: 'agent',
      agentType: 'local',
      modelId: 'runtime:agent',
      assistantMessageId: reply.id,
      userMessage: user
    })
    const source = service.openTurnStream({
      sessionId: 'root',
      turnId: handle.turnId,
      signal: handle.abortController.signal
    })
    const views: CherryUIMessage[] = []
    // Dispatch by the production source contract, never unwrap message controls into chunks.
    const reading =
      source.kind === 'messages'
        ? pipeMessageStream(
            source.stream,
            handle.abortController.signal,
            { id: reply.id, role: 'assistant', parts: [] },
            (message) => views.push(message),
            () => {}
          )
        : pipeStreamLoop(source.stream, handle.abortController.signal, {
            onChunk: () => {},
            onAccumulatedSnapshot: (message) => views.push(message)
          })
    if (status === 'live') {
      await expect
        .poll(() =>
          views.some((message) => message.parts.some((part) => part.type === 'text' && part.text === 'Hello local'))
        )
        .toBe(true)
      release.resolve()
    }
    const result = await reading
    expect(result.threw?.error).toBe(status === 'error' ? failure : undefined)
    expect(result.finalMessage?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: 'Hello local' }),
        expect.objectContaining({ type: 'reasoning', text: 'Thinking' }),
        expect.objectContaining({
          type: 'dynamic-tool',
          toolCallId: 'tool',
          state: 'output-available',
          output: 'contents'
        })
      ])
    )
    expect(
      views.some((message) => message.parts.some((part) => part.type === 'text' && part.text === 'Hello local'))
    ).toBe(true)
    const finalMessage = result.finalMessage ? { ...result.finalMessage, id: reply.id } : undefined
    if (status === 'error') {
      const outcome = {
        status,
        finalMessage,
        error: { name: failure.name, message: failure.message, stack: failure.stack ?? null }
      }
      await handle.listeners[0].onError(outcome)
      await handle.listeners[1].onError(outcome)
    } else {
      const outcome = { status: 'success' as const, finalMessage }
      await handle.listeners[0].onDone(outcome)
      await handle.listeners[1].onDone(outcome)
    }
    expect(messages.getSessionMessage('root', reply.id)).toMatchObject({
      status: status === 'error' ? 'error' : 'success',
      data: { parts: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Hello local' })]) }
    })
  }
)
