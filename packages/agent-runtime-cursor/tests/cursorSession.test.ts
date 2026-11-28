import { Agent, Cursor, type AgentOptions } from '@cursor/sdk'
import { afterEach, expect, it, vi } from 'vitest'

import { listCursorModels, openCursorSession, sendCursorTurn, type SDKAgent } from '../src/adapter'

const env = {}
const readShellEnv = async () => ({})
const signal = new AbortController().signal

afterEach(() => vi.restoreAllMocks())

it.each([undefined, 'saved-agent'])('opens %s with the native workspace, toolset and permissions', async (agentId) => {
  const cwd = '/selected/workspace'
  const browser = { type: 'http' as const, url: 'http://localhost/automation' }
  const opened = new Error('Captured SDK options')
  const inspect = async (options?: Partial<AgentOptions>): Promise<never> => {
    expect(options?.local?.cwd).toBe(cwd)
    expect(options?.local?.autoReview).toBe(true)
    expect(options?.local?.fs).toBeUndefined()
    expect(options?.local?.customTools).toBeUndefined()
    expect(options?.tools).toBeUndefined()
    expect(options?.disallowedTools).toBeUndefined()
    expect(options?.mcpServers?.automation).toEqual(browser)
    throw opened
  }
  if (agentId) {
    vi.spyOn(Agent, 'create').mockRejectedValue(new Error('Opened a replacement agent'))
    vi.spyOn(Agent, 'resume').mockImplementation(async (id, options) => {
      expect(id).toBe(agentId)
      return inspect(options)
    })
  } else {
    vi.spyOn(Agent, 'create').mockImplementation(inspect)
    vi.spyOn(Agent, 'resume').mockRejectedValue(new Error('Tried to resume a new chat'))
  }
  await expect(
    openCursorSession({ cwd, model: 'composer', browser, agentId, headless: true, env, readShellEnv })
  ).rejects.toBe(opened)
})

it('sets an advertised effort on the next SDK send and preserves the selected context', async () => {
  vi.spyOn(Cursor.models, 'list').mockResolvedValue([
    {
      id: 'composer',
      displayName: 'Composer',
      parameters: [
        { id: 'thinking', values: [{ value: 'true' }, { value: 'false' }] },
        { id: 'reasoning_effort', values: [{ value: 'low' }, { value: 'xhigh', displayName: 'Extra high' }] }
      ],
      variants: [
        {
          displayName: 'Default',
          isDefault: true,
          params: [
            { id: 'context', value: 'long' },
            { id: 'reasoning_effort', value: 'low' }
          ]
        },
        {
          displayName: 'Extra high',
          params: [
            { id: 'context', value: 'long' },
            { id: 'reasoning_effort', value: 'xhigh' }
          ]
        }
      ]
    }
  ])
  expect(await listCursorModels(env, readShellEnv, signal)).toMatchObject([
    {
      id: 'composer',
      effort: { defaultValue: 'low', options: [{ value: 'low' }, { value: 'xhigh', name: 'Extra high' }] }
    }
  ])
  const recorded = new Error('Recorded SDK request')
  const send: SDKAgent['send'] = async (_message, input) => {
    expect(input?.model).toEqual({
      id: 'composer',
      params: [
        { id: 'context', value: 'long' },
        { id: 'reasoning_effort', value: 'xhigh' }
      ]
    })
    throw recorded
  }
  vi.spyOn(Agent, 'create').mockResolvedValue({
    model: { id: 'composer', params: [{ id: 'context', value: 'long' }] },
    send
  } as SDKAgent)
  const { agent, effort } = await openCursorSession({ cwd: '/workspace', model: 'composer', env, readShellEnv })
  expect(effort?.control).toMatchObject({
    modelId: 'composer',
    currentValue: 'low',
    options: [
      { value: 'low', name: 'low' },
      { value: 'xhigh', name: 'Extra high' }
    ]
  })
  const host = { modelCallCompleted: vi.fn(), append: vi.fn(), toolStarted: vi.fn(), toolCompleted: vi.fn() }
  await expect(sendCursorTurn(agent, { text: 'inspect' }, 'plan', host, effort?.modelFor('xhigh'))).rejects.toBe(
    recorded
  )
})

it('reports a native shell permission denial on the original tool call', async () => {
  const host = { modelCallCompleted: vi.fn(), append: vi.fn(), toolStarted: vi.fn(), toolCompleted: vi.fn() }
  const denied = { message: 'Denied by Cursor policy' }
  const stopped = new Error('End of recorded turn')
  const send: SDKAgent['send'] = async (_message, options) => {
    expect(options?.mode).toBe('plan')
    expect(options?.local?.customTools).toBeUndefined()
    const call = { callId: 'shell-1', modelCallId: 'turn-1' }
    const tool = { type: 'shell' as const, args: { command: 'pwd' } }
    await options?.onDelta?.({ update: { type: 'tool-call-started', ...call, toolCall: tool } })
    await options?.onDelta?.({
      update: {
        type: 'tool-call-completed',
        ...call,
        toolCall: { ...tool, result: { status: 'error', error: denied } }
      }
    })
    throw stopped
  }
  await expect(sendCursorTurn({ send }, { text: 'inspect' }, 'plan', host)).rejects.toBe(stopped)
  expect(host.toolStarted).toHaveBeenCalledWith('shell-1', 'Shell', { command: 'pwd' })
  expect(host.toolCompleted).toHaveBeenCalledWith('shell-1', denied, true)
})
