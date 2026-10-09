import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import {
  appendNoResponseErrorPart,
  hasVisibleAgentSessionPart,
  isVisibleAgentSessionPart
} from '../agentSessionNoResponse'

describe('isVisibleAgentSessionPart', () => {
  it('treats hidden part types as invisible', () => {
    expect(isVisibleAgentSessionPart({ type: 'step-start' })).toBe(false)
    expect(
      isVisibleAgentSessionPart({ type: 'data-agent-task-event', data: { event: 'started', taskId: 'task-1' } })
    ).toBe(false)
    expect(isVisibleAgentSessionPart({ type: 'data-knowledge-scope', data: { baseIds: ['kb-1'] } })).toBe(false)
  })

  it('filters empty text and non-streaming empty reasoning, but keeps real content', () => {
    expect(isVisibleAgentSessionPart({ type: 'text', text: '   ' })).toBe(false)
    expect(isVisibleAgentSessionPart({ type: 'text', text: 'answer' })).toBe(true)
    expect(isVisibleAgentSessionPart({ type: 'reasoning', state: 'done', text: '' })).toBe(false)
    expect(isVisibleAgentSessionPart({ type: 'reasoning', state: 'streaming', text: '' })).toBe(true)
    expect(
      isVisibleAgentSessionPart({
        type: 'tool-Read',
        state: 'output-available',
        toolCallId: 't1',
        input: {},
        output: {}
      })
    ).toBe(true)
  })

  it('keeps tool parts the renderer gives a card, and drops cardless tool-only turns', () => {
    // Runtime builtin tool (pi/dsh `bash`) renders through the agent timeline card.
    expect(
      isVisibleAgentSessionPart({ type: 'tool-bash', state: 'output-available', toolCallId: 't1', input: {} } as never)
    ).toBe(true)
    expect(
      isVisibleAgentSessionPart({
        type: 'tool-builtin_AskUserQuestion',
        state: 'output-available',
        toolCallId: 't1-legacy',
        input: {}
      } as never)
    ).toBe(true)
    // A dynamic call with no classification signal at all falls back to the generic MCP card.
    expect(
      isVisibleAgentSessionPart({
        type: 'dynamic-tool',
        toolName: 'anything_at_all',
        state: 'output-available',
        toolCallId: 't2',
        input: {}
      } as never)
    ).toBe(true)
    // An unrecognized builtin-wire tool renders no card, so a turn of only it is empty.
    expect(
      isVisibleAgentSessionPart({
        type: 'tool-some_future_runtime_tool',
        state: 'output-available',
        toolCallId: 't3',
        input: {}
      } as never)
    ).toBe(false)
    expect(
      isVisibleAgentSessionPart({
        type: 'tool-EnterPlanMode',
        state: 'output-available',
        toolCallId: 't4',
        input: {}
      } as never)
    ).toBe(false)
  })

  it('renders dynamic MCP tools but not cardless dynamic provider tools', () => {
    // Every provider-executed runtime emits its native calls as dynamic parts
    // (`dynamic: true` + `providerExecuted: true` + `cherry.tool.type`), so the
    // provider/native and MCP shapes must be told apart exactly like the renderer.
    const claudeCodeNative = (toolName: string, toolType = 'provider') =>
      ({
        type: 'dynamic-tool',
        toolCallId: `t-${toolName}`,
        toolName,
        state: 'output-available',
        input: {},
        providerExecuted: true,
        callProviderMetadata: {
          cherry: { transport: 'claude-agent', tool: { type: toolType, name: toolName } }
        }
      }) as never
    // Native tools with a card (chooseTool's agent-tool names) stay visible.
    expect(isVisibleAgentSessionPart(claudeCodeNative('Bash'))).toBe(true)
    expect(isVisibleAgentSessionPart(claudeCodeNative('ExitPlanMode'))).toBe(true)
    // EnterPlanMode has no card in chooseTool: a turn of only it is a no-response turn.
    expect(isVisibleAgentSessionPart(claudeCodeNative('EnterPlanMode'))).toBe(false)
    // The approval re-emission path drops providerMetadata but keeps providerExecuted.
    expect(
      isVisibleAgentSessionPart({
        type: 'dynamic-tool',
        toolCallId: 't-approval-plan',
        toolName: 'EnterPlanMode',
        state: 'output-available',
        input: {},
        providerExecuted: true
      } as never)
    ).toBe(false)
    // Dynamic MCP calls keep the generic MCP card, with or without cherry metadata.
    expect(
      isVisibleAgentSessionPart({
        type: 'dynamic-tool',
        toolCallId: 't-mcp-meta',
        toolName: 'mcp__cherry-tools__web_fetch',
        state: 'output-available',
        input: {},
        providerExecuted: true,
        callProviderMetadata: {
          cherry: { transport: 'claude-agent', tool: { type: 'mcp', serverId: 'cherry-tools' } }
        }
      } as never)
    ).toBe(true)
    expect(
      isVisibleAgentSessionPart({
        type: 'dynamic-tool',
        toolCallId: 't-mcp-bare',
        toolName: 'mcp__exa__search',
        state: 'output-available',
        input: {},
        providerExecuted: true
      } as never)
    ).toBe(true)
  })

  it('maps dynamic runtime tool names onto their card names before judging them', () => {
    // pi/dsh natives carry lower-case runtime names; chooseTool only knows the shared
    // agent-tool name they normalize onto (renderer getCanonicalToolName).
    const runtimeNative = (toolName: string, transport: string) =>
      ({
        type: 'dynamic-tool',
        toolCallId: `t-${transport}-${toolName}`,
        toolName,
        state: 'output-available',
        input: {},
        providerExecuted: true,
        callProviderMetadata: { cherry: { transport, tool: { type: 'builtin', name: toolName } } }
      }) as never
    expect(isVisibleAgentSessionPart(runtimeNative('read', 'pi-agent'))).toBe(true)
    expect(isVisibleAgentSessionPart(runtimeNative('todo_write', 'dsh-agent'))).toBe(true)
    expect(isVisibleAgentSessionPart(runtimeNative('codemode', 'pi-agent'))).toBe(true)
    // A dsh native without a card mapping (chooseTool returns null for it) renders nothing.
    expect(isVisibleAgentSessionPart(runtimeNative('get_goal', 'dsh-agent'))).toBe(false)
  })

  it('drops file parts the renderer cannot render, keeps resolvable ones', () => {
    // An image without a URL renders nothing.
    expect(isVisibleAgentSessionPart({ type: 'file', mediaType: 'image/png' } as never)).toBe(false)
    // A non-image file addressing no entry and no decodable path renders nothing.
    expect(isVisibleAgentSessionPart({ type: 'file', mediaType: 'text/plain', filename: 'a.txt' } as never)).toBe(false)
    expect(
      isVisibleAgentSessionPart({ type: 'file', mediaType: 'text/plain', url: 'https://not-a-file' } as never)
    ).toBe(false)
    // An image with a URL and a file addressed by a file:// URL render.
    expect(isVisibleAgentSessionPart({ type: 'file', mediaType: 'image/png', url: 'https://x/y.png' } as never)).toBe(
      true
    )
    expect(
      isVisibleAgentSessionPart({
        type: 'file',
        mediaType: 'text/plain',
        url: 'file:///tmp/cherry/report.txt'
      } as never)
    ).toBe(true)
  })

  it('drops video parts without a URL or local path', () => {
    expect(isVisibleAgentSessionPart({ type: 'data-video', data: {} } as never)).toBe(false)
    expect(isVisibleAgentSessionPart({ type: 'data-video', data: { filePath: '/tmp/cherry/clip.mp4' } } as never)).toBe(
      true
    )
    expect(isVisibleAgentSessionPart({ type: 'data-video', data: { url: 'https://x/clip.mp4' } } as never)).toBe(true)
  })

  it('judges whole part arrays with the same rule the renderer uses for the fallback', () => {
    const hiddenOnly: CherryMessagePart[] = [
      { type: 'data-agent-task-event', data: { event: 'started', taskId: 'task-1' } },
      { type: 'step-start' }
    ]
    const emptyOnly: CherryMessagePart[] = [{ type: 'text', text: ' ' }]
    const normal: CherryMessagePart[] = [{ type: 'step-start' }, { type: 'text', text: 'answer' }]
    expect(hasVisibleAgentSessionPart(hiddenOnly)).toBe(false)
    expect(hasVisibleAgentSessionPart(emptyOnly)).toBe(false)
    expect(hasVisibleAgentSessionPart(normal)).toBe(true)
    expect(hasVisibleAgentSessionPart(undefined)).toBe(false)
  })
})

describe('appendNoResponseErrorPart', () => {
  it('appends exactly one no-response error part and preserves the rest of the data', () => {
    const data = { parts: [{ type: 'text', text: 'partial' }] as CherryMessagePart[], turnOptions: {} }
    const result = appendNoResponseErrorPart(data, {
      message: 'no output',
      i18nKey: 'agent_turn_no_output',
      reason: 'empty-success-terminal'
    })

    expect(result.parts).toHaveLength(2)
    expect(result.parts?.[1]).toMatchObject({
      type: 'data-error',
      data: {
        name: 'AgentRuntimeError',
        message: 'no output',
        stack: null,
        i18nKey: 'agent_turn_no_output',
        reason: 'empty-success-terminal'
      }
    })
    expect(result.turnOptions).toBe(data.turnOptions)
  })

  it('leaves data that already carries a data-error part untouched', () => {
    const data = { parts: [{ type: 'data-error', data: { message: 'boom' } }] as CherryMessagePart[] }
    expect(appendNoResponseErrorPart(data, { message: 'no output' })).toBe(data)
  })
})
