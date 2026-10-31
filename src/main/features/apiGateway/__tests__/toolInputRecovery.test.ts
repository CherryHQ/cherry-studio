import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import {
  createTestSession,
  finish,
  gatewayModel,
  lastAssistant,
  scriptedModel,
  textParts
} from '@test-helpers/piGateway'
import { describe, expect, it } from 'vitest'

describe('client tool validation through the gateway', () => {
  it.each(['invalid-schema', 'unknown-tool'])('lets Pi reject and correct %s without executing it', async (failure) => {
    const executed: unknown[] = []
    const tool = defineTool({
      name: 'read_file',
      label: 'read_file',
      description: 'Read a file',
      parameters: Type.Object({ path: Type.String() }),
      async execute(_id, args) {
        executed.push(args)
        return { content: [{ type: 'text', text: 'file contents' }], details: undefined }
      }
    })
    const { model } = scriptedModel([
      [
        {
          type: 'tool-call',
          toolCallId: 'invalid-call',
          toolName: failure === 'unknown-tool' ? 'missing_tool' : 'read_file',
          input: '{"path":{"nested":true}}'
        },
        finish('tool-calls')
      ],
      [
        { type: 'tool-call', toolCallId: 'corrected-call', toolName: 'read_file', input: '{"path":"README.md"}' },
        finish('tool-calls')
      ],
      [...textParts('answer', 'recovered'), finish('stop')]
    ])
    const { upstream, requests } = gatewayModel(model)
    const { session } = await createTestSession({ port: upstream, tools: [tool] })

    await session.prompt('Read the file')

    expect(executed).toEqual([{ path: 'README.md' }])
    expect(requests).toHaveLength(3)
    expect(session.messages).toContainEqual(
      expect.objectContaining({ role: 'toolResult', toolCallId: 'invalid-call', isError: true })
    )
    expect(requests[1].messages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        content: expect.arrayContaining([
          expect.objectContaining({
            toolCallId: 'invalid-call',
            output: expect.objectContaining({
              value: expect.stringContaining(
                failure === 'unknown-tool' ? 'Tool missing_tool not found' : 'path: must be string'
              )
            })
          })
        ])
      })
    )
    expect(lastAssistant(session)).toMatchObject({
      stopReason: 'stop',
      content: [{ type: 'text', text: 'recovered' }]
    })
  })
  it.each(['null', '[]', 'false', '{', '{}'])(
    'executes only valid optional tool input from the gateway: %s',
    async (input) => {
      const executed: unknown[] = []
      const tool = defineTool({
        name: 'optional_tool',
        label: 'optional_tool',
        description: 'Accepts an optional path',
        parameters: Type.Object({ path: Type.Optional(Type.String()) }),
        async execute(_id, args) {
          executed.push(args)
          return { content: [{ type: 'text', text: 'done' }], details: undefined }
        }
      })
      const { model } = scriptedModel([
        [{ type: 'tool-call', toolCallId: 'call', toolName: 'optional_tool', input }, finish('tool-calls')],
        [...textParts('t', 'complete'), finish('stop')]
      ])
      const { session } = await createTestSession({ port: gatewayModel(model).upstream, tools: [tool] })
      await session.prompt('use the optional tool')
      if (input !== '{}') {
        expect(executed).toEqual([])
        expect(lastAssistant(session).stopReason).toBe('error')
      } else {
        expect(executed).toEqual([{}])
        expect(lastAssistant(session).content).toEqual([{ type: 'text', text: 'complete' }])
      }
    }
  )
})
