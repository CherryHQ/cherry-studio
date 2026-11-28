import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentProviderService } from '@data/services/AgentProviderService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { localLaunch } from '@main/ai/runtime/__tests__/fixtures/localLaunch'
import { LocalConnection } from '@main/ai/runtime/LocalConnection'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeUserInput } from '@main/ai/runtime/types'
import { pipeMessageStream } from '@main/ai/streamManager/pipeMessageStream'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { CherryUIMessage } from '@shared/data/types/message'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'

const dbh = setupTestDatabase()
beforeEach(() => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
})

it.each(['success', 'error', 'live'] as const)(
  'preserves local text, reasoning and tool output through the addressed stream on %s',
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
    const failure = new Error('Local process failed')
    const release = Promise.withResolvers<void>()
    onTestFinished(() => release.resolve())
    class TestConnection extends LocalConnection {
      async send(input: AgentRuntimeUserInput) {
        this.begin(input.message.id)
        this.content('Thinking', 'reasoning')
        this.content('Hello ')
        this.content('local')
        if (status === 'live') await release.promise
        this.endContent()
        this.tool('tool', 'Read', { path: 'a' })
        this.result('tool', 'contents')
        this.finish(status === 'error' ? failure : undefined)
      }
      protected async stop() {}
    }
    const config = agentProviderService.setBindingTx(dbh.db, 'agent', { enabled: true, presetId: 'codex' })
    const launch = localLaunch(config, config.providerId)
    runtimeDriverRegistry.register({
      type: 'local',
      validateSession: () => {},
      connect: async () => new TestConnection('root', 'agent', launch.config, launch.target)
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
    const reading = pipeMessageStream(
      source,
      handle.abortController.signal,
      { id: reply.id, role: 'assistant' },
      (message) => views.push(message),
      () => {},
      () => {
        views.push({ id: reply.id, role: 'assistant', parts: source.readParts().map((part) => part.payload) })
      }
    )
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
