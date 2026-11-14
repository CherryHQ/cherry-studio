import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrepareChatContext } from '@main/ai/messages/attachmentRouting'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'

import type { AgentRuntimeEvent } from '../../types'

const state = vi.hoisted(() => ({
  vision: false,
  rejected: false,
  submitted: [] as unknown[],
  observe: undefined as ((batch: unknown) => Promise<void>) | undefined
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory, MockApplicationUtils } = await import('@test-mocks/main/application')
  MockApplicationUtils.setService('ClaudeCodeWarmQueryManager', { consume: async () => undefined })
  return mockApplicationFactory()
})
vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: () => ({ capabilities: state.vision ? ['image-recognition'] : [] }) }
}))
vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { getLastRuntimeResumeToken: () => undefined }
}))
vi.mock('@data/services/AgentSessionContextService', () => ({
  agentSessionContextService: { children: () => [] }
}))
vi.mock('@main/ai/agentSession/nativeSubmission', () => ({
  prepareNativeSubmission: () => ({ inputId: 'input' }),
  applyNativeSubmissionResult: () => {}
}))
vi.mock('@main/ai/agentSession/ThreadMessageProjection', () => ({
  ThreadMessageProjection: class {
    snapshot() {
      return { messages: [] }
    }
    async accept() {
      return []
    }
    async close() {}
  }
}))
vi.mock('../claudeContext', () => ({
  prepareClaudeBranch: () => ({ id: 'context', backendId: 'backend', nativeThreadId: 'native' })
}))
vi.mock('../settingsBuilder', () => ({
  registerMcpSessionCatalogSync: () => {},
  disposeToolPolicySnapshot: () => {}
}))
vi.mock('../agentSessionWarmup', () => ({
  buildClaudeCodeQueryRequestForAgentSession: async () => ({
    key: 'query',
    options: { cwd: '/test', env: {} },
    settings: {},
    sdkModelId: 'model'
  })
}))
vi.mock('@cherrystudio/agent-runtime-claude-code', () => ({
  createClaudeCodeRuntime: () => ({
    create: async () => ({
      status: 'confirmed',
      value: {
        thread: { id: 'native' },
        claude: {
          start: () => ({ status: 'confirmed' }),
          observe: async (callback: (batch: unknown) => Promise<void>) => {
            state.observe = callback
            return { status: 'confirmed', value: { drain: async () => {}, stop: async () => {} } }
          },
          submit: async (_id: string, content: unknown) => {
            state.submitted.push(content)
            return state.rejected
              ? { status: 'rejected', inputId: 'input', error: { message: 'Rejected' } }
              : { status: 'acknowledged', inputId: 'input', facts: ['dispatch-started'] }
          }
        }
      }
    }),
    shutdown: async () => {
      await state.observe?.({ events: [{ type: 'closed', reason: 'shutdown' }], controls: [] })
      return { status: 'confirmed' }
    }
  })
}))
vi.mock('@main/ai/messages/attachmentRouting', () => ({
  collectFileAttachments: () => [],
  prepareChatMessages: async (messages: UIMessage[], context: PrepareChatContext) => {
    if (context.nativeSupport.image) return messages
    context.onImageOcrFallback?.({ messageId: messages[0].id, displayName: 'image.png' })
    return [{ ...messages[0], parts: [{ type: 'text', text: 'OCR text from image' }] }]
  }
}))
vi.mock('@main/ai/messages/fileProcessor', () => ({
  materializeNativeFilePart: async (part: object) => ({ ...part, url: 'data:image/png;base64,AA==' })
}))

import { ClaudeCodeRuntimeDriver } from '../ClaudeCodeRuntimeDriver'

beforeEach(() => {
  state.vision = false
  state.rejected = false
  state.submitted = []
  state.observe = undefined
})

async function run(steer: boolean) {
  const connection = await new ClaudeCodeRuntimeDriver().connect({
    sessionId: 'session',
    agentId: 'agent',
    modelId: 'provider::model'
  })
  const message = {
    id: 'user-image',
    data: {
      parts: [
        {
          type: 'file',
          filename: 'image.png',
          mediaType: 'image/png',
          url: 'file:///test/image.png',
          providerMetadata: { cherry: { fileEntryId: 'image-entry' } }
        }
      ]
    }
  } as unknown as AgentSessionMessageEntity
  const events: AgentRuntimeEvent[] = []
  const reading = (async () => {
    for await (const event of connection.events) events.push(event)
  })()
  if (steer) {
    const completed = new Promise<void>((resolve) => {
      const submit = state.submitted
      vi.spyOn(submit, 'push').mockImplementation((...items) => {
        const result = Array.prototype.push.apply(submit, items)
        queueMicrotask(() => queueMicrotask(resolve))
        return result
      })
    })
    expect(connection.redirect?.({ message })).toBe(true)
    await completed
  } else if (state.rejected) {
    await expect(connection.send({ message })).rejects.toThrow('Rejected')
  } else {
    await connection.send({ message })
  }
  await connection.close()
  await reading
  return events.filter((event) => event.type === 'chunk' && event.chunk.type === 'data-attachment-notice')
}

describe('Claude agent attachment notices', () => {
  it.each([false, true])('emits OCR notice after acknowledged input (steer=%s)', async (steer) => {
    const notices = await run(steer)
    expect(notices).toEqual([
      {
        type: 'chunk',
        chunk: {
          type: 'data-attachment-notice',
          id: 'attachment-notice:user-image',
          data: { kind: 'image-ocr', fileNames: ['image.png'] }
        }
      }
    ])
    expect(JSON.stringify(state.submitted)).toContain('OCR text from image')
  })

  it('does not warn when the model receives a native image', async () => {
    state.vision = true
    expect(await run(false)).toEqual([])
    expect(JSON.stringify(state.submitted)).toContain('base64')
  })

  it('does not claim image delivery when native submission is rejected', async () => {
    state.rejected = true
    expect(await run(false)).toEqual([])
  })
})
