// @vitest-environment node
import { fauxToolCall } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { obj } from '@earendil-works/pi-schema'
import { expect, it, onTestFinished } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { convertMcpResult } from '../../../../../../../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js'
import { PiProjection } from '../../../../../../../../packages/agent-runtime-pi/src/runtimeProjection'
import {
  assistantReply,
  createTestSession,
  scriptedModel
} from '../../../../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { buildToolResponseFromPart, PI_AGENT_TRANSPORT } from '../../toolResponse'
import { getAutomationCell, parseAutomationReplOutput } from '../automationRepl'

it.each([false, true])(
  'retains the REPL cell through Pi conversion, live projection and restored history (error=%s)',
  async (isError) => {
    const cell = '12345678-1234-4234-8234-123456789abc'
    const result = {
      content: [
        { type: 'text' as const, text: isError ? 'Script failed' : 'Script completed' },
        {
          type: 'text' as const,
          text: `REPL_CONTEXT ${JSON.stringify({ cell })}`,
          annotations: { audience: ['assistant' as const] }
        }
      ],
      structuredContent: { replContext: { cell } },
      isError
    }
    const converted = await convertMcpResult('automation', 'js', result)
    const { model } = scriptedModel([
      assistantReply([fauxToolCall('mcp__automation__js', {}, { id: 'call' })], 'toolUse'),
      assistantReply('Done')
    ])
    const { session } = await createTestSession({
      stream: model,
      tools: [
        defineTool({
          name: 'mcp__automation__js',
          label: 'JS',
          description: 'Execute',
          parameters: obj({}),
          execute: async () => converted
        })
      ]
    })
    const thread = { backendId: runtimeId<'backend'>('pi'), id: runtimeId<'thread'>('transport') }
    const errors: unknown[] = []
    const live = new PiProjection(thread, session, (error) => errors.push(error), false)
    onTestFinished(() => live.close())
    const check = (projection: PiProjection) => {
      const part = projection.feed.snapshot.messages
        .flatMap((message) => message.parts)
        .find((part) => part.type === 'dynamic-tool')
      expect(part).toBeDefined()
      if (!part) throw new Error('Missing tool part')
      if (part.type !== 'dynamic-tool') throw new Error('Missing tool result')
      const response = buildToolResponseFromPart({
        ...part,
        callProviderMetadata: { cherry: { transport: PI_AGENT_TRANSPORT } }
      })?.response
      expect(getAutomationCell(response)).toBe(cell)
      expect(parseAutomationReplOutput(response)).toEqual({
        text: isError ? 'Script failed' : 'Script completed',
        isError
      })
      expect(response).toEqual(result)
      expect(response).not.toHaveProperty('_meta')
      expect(response).not.toHaveProperty('apps')
    }
    await session.prompt('Run the cell')
    await expect
      .poll(() =>
        live.feed.snapshot.messages
          .flatMap((message) => message.parts)
          .some(
            (part) => part.type === 'dynamic-tool' && part.state === (isError ? 'output-error' : 'output-available')
          )
      )
      .toBe(true)
    check(live)
    const restored = new PiProjection(thread, session, (error) => errors.push(error), false)
    onTestFinished(() => restored.close())
    check(restored)
    expect(errors).toEqual([])
  }
)
