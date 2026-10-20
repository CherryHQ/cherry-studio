import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { ComputerUseError, type Snapshot } from '@cherrystudio/computer-use'
import { BaseService } from '@main/core/lifecycle'
import { ComputerUseService } from '@main/services/ComputerUseService'

import { createComputerUseToolEntries } from '../ComputerUseTools'

const entries = createComputerUseToolEntries()
let service: ComputerUseService
let options: ToolExecutionOptions

beforeEach(() => {
  BaseService.resetInstances()
  service = new ComputerUseService()
  const get = application.getContainer().get.bind(application.getContainer())
  vi.spyOn(application, 'get').mockImplementation(((name: string) =>
    name === 'ComputerUseService' ? service : get(name as Parameters<typeof get>[0])) as typeof application.get)
  options = {
    toolCallId: 'observe',
    messages: [],
    experimental_context: { requestId: 'request', computerUseTask: service.createTask('owner', 'Conversation') }
  }
})
afterEach(() => vi.restoreAllMocks())

describe('Computer Use model boundary', () => {
  it('passes image bytes as an image and preserves snapshot and element references', async () => {
    const snapshot: Snapshot = {
      id: 'snapshot-1',
      appSessionId: 'session-1',
      app: { id: 'editor', name: 'Editor' },
      window: { id: 'window-1', title: 'Document' },
      tree: {
        status: 'available',
        elements: [{ id: 'button-1', role: 'button', name: 'Save', actions: ['click'], secondaryActions: [] }],
        truncated: []
      },
      screenshot: {
        status: 'available',
        image: { data: Uint8Array.from([1, 2, 3]), mimeType: 'image/png', width: 30, height: 20 }
      }
    }
    vi.spyOn(service, 'getAppState').mockResolvedValue(snapshot)
    const entry = entries.find((entry) => entry.name === 'computer_get_app_state')!
    const output = await entry.tool.execute!({ appSessionId: 'session-1' }, options)
    const model = await entry.tool.toModelOutput!({ toolCallId: 'observe', input: {}, output })
    expect(model).toMatchObject({
      type: 'content',
      value: [
        { type: 'text', text: expect.stringContaining('"id":"button-1"') },
        { type: 'image-data', data: 'AQID', mediaType: 'image/png' }
      ]
    })
    expect(JSON.stringify(model)).toContain('snapshot-1')
    expect(JSON.stringify(model)).not.toContain('dataBase64')
  })

  it('sends the runtime outline as its own text part instead of the element JSON', async () => {
    const snapshot: Snapshot = {
      id: 'snapshot-1',
      appSessionId: 'session-1',
      app: { id: 'editor', name: 'Editor' },
      window: { id: 'window-1', title: 'Document' },
      tree: {
        status: 'available',
        elements: [{ id: '3', role: 'AXButton', name: 'Save', actions: ['click'], secondaryActions: [] }],
        text: '0 standard window Document\n\t3 button Save',
        truncated: ['nodes']
      },
      screenshot: { status: 'unavailable', reason: { code: 'CAPTURE_FAILED', message: 'Capture unavailable' } }
    }
    vi.spyOn(service, 'getAppState').mockResolvedValue(snapshot)
    const entry = entries.find((entry) => entry.name === 'computer_get_app_state')!
    const output = await entry.tool.execute!({ appSessionId: 'session-1' }, options)
    expect(output.content).toEqual([
      { type: 'text', text: expect.stringContaining('"truncated":["nodes"]') },
      { type: 'text', text: '0 standard window Document\n\t3 button Save' }
    ])
    expect(output.content[0]).not.toMatchObject({ text: expect.stringContaining('"elements"') })
  })

  it('maps coordinate clicks and typed input to runtime actions and rejects ambiguous clicks', async () => {
    const act = vi.spyOn(service, 'act').mockResolvedValue({
      status: 'completed',
      observation: { status: 'unavailable', reason: { code: 'CAPTURE_FAILED', message: 'Capture unavailable' } }
    })
    const call = (name: string, input: Record<string, unknown>) =>
      entries.find((entry) => entry.name === name)!.tool.execute!(input, options)
    const ids = { appSessionId: 'session-1', snapshotId: 'snapshot-1' }
    await call('computer_click', { ...ids, x: 12, y: 34, button: 'right' })
    await call('computer_type_text', { ...ids, text: 'hello' })
    expect(act.mock.calls.map(([, action]) => action)).toEqual([
      { type: 'click', ...ids, x: 12, y: 34, button: 'right' },
      { type: 'typeText', ...ids, text: 'hello' }
    ])
    await expect(call('computer_click', { ...ids, elementId: '3', x: 1, y: 2 })).rejects.toThrow('either elementId')
    await expect(call('computer_click', ids)).rejects.toThrow('either elementId')
    expect(act).toHaveBeenCalledTimes(2)
  })

  it('returns uncertain effects without replaying clicks and preserves completed-but-unobserved results', async () => {
    const click = vi
      .spyOn(service, 'act')
      .mockRejectedValueOnce(new ComputerUseError('TIMEOUT', 'Effect uncertain', { effect: 'possible' }))
      .mockResolvedValueOnce({
        status: 'completed',
        observation: { status: 'unavailable', reason: { code: 'CAPTURE_FAILED', message: 'Capture unavailable' } }
      })
    const entry = entries.find((entry) => entry.name === 'computer_click')!
    const input = { appSessionId: 'session-1', snapshotId: 'snapshot-1', elementId: 'button-1' }
    const failed = await entry.tool.execute!(input, options)
    expect(failed).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('"effect":"possible"') }] })
    expect(click).toHaveBeenCalledTimes(1)
    const completed = await entry.tool.execute!(input, options)
    expect(completed).toMatchObject({ content: [{ text: expect.stringContaining('"status":"completed"') }] })
    expect(completed).not.toHaveProperty('isError')
  })

  it('exposes only the supported slice and refuses calls without a host task', async () => {
    expect(entries.map((entry) => entry.name)).toEqual([
      'computer_list_apps',
      'computer_open_app',
      'computer_get_app_state',
      'computer_click',
      'computer_perform_secondary_action',
      'computer_scroll',
      'computer_drag',
      'computer_type_text',
      'computer_press_key',
      'computer_set_value'
    ])
    expect(entries.every((entry) => !entry.applies!({ mcpToolIds: new Set() }))).toBe(true)
    expect(entries.every((entry) => entry.applies!({ mcpToolIds: new Set(), computerUseEnabled: true }))).toBe(true)
    const entry = entries[0]
    await expect(async () =>
      entry.tool.execute!({}, { ...options, experimental_context: { requestId: 'forged' } })
    ).rejects.toThrow('host-owned control task')
  })
})
